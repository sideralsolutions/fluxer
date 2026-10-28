// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {Logger} from '@app/features/platform/utils/AppLogger';
import Users from '@app/features/user/state/Users';
import EntranceSoundPlaybackEngine from '@app/features/voice/engine/EntranceSoundPlaybackEngine';
import type {EntranceSoundEntry} from '@app/features/voice/state/EntranceSoundLibrary';
import {parseVoiceParticipantIdentity} from '@app/features/voice/utils/VoiceParticipantIdentity';
import {
	ENTRANCE_SOUND_EXTENSIONS,
	ENTRANCE_SOUND_MAX_DURATION_MS,
	type EntranceSoundExtension,
} from '@fluxer/constants/src/EntranceSoundConstants';
import {type Participant, type Room, RoomEvent} from 'livekit-client';
import {action, makeObservable, observable} from 'mobx';

const logger = new Logger('Soundboard');

const PROTOCOL_TOPIC = 'fluxer.soundboard.v1';
const PLAY_COOLDOWN_MS = 1000;
const HASH_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

interface SoundboardPlayMessage {
	hash: string;
	ext: EntranceSoundExtension;
	duration_ms: number;
}

// Sounds come from each member's entrance sound library. Plays travel over the LiveKit data channel instead of the
// entrance sound endpoint, which is rate limited for joins and is dropped by listeners outside the join chime window.
// Listeners rebuild the sound URL from the sender's authenticated identity, so a peer cannot make them fetch other URLs.
class Soundboard {
	private room: Room | null = null;
	private disposer: (() => void) | null = null;
	private lastPlayAt = new Map<string, number>();
	available = false;

	constructor() {
		makeObservable(this, {available: observable, bind: action, dispose: action});
	}

	bind(room: Room): void {
		this.dispose();
		this.room = room;
		this.available = true;
		const onDataReceived = (
			payload: Uint8Array,
			participant: Participant | undefined,
			_kind: unknown,
			topic?: string,
		): void => {
			if (topic !== PROTOCOL_TOPIC || !participant) return;
			this.handleMessage(participant, payload);
		};
		room.on(RoomEvent.DataReceived, onDataReceived);
		this.disposer = () => room.off(RoomEvent.DataReceived, onDataReceived);
	}

	dispose(): void {
		this.disposer?.();
		this.disposer = null;
		this.room = null;
		this.available = false;
		this.lastPlayAt.clear();
	}

	async play(sound: EntranceSoundEntry): Promise<void> {
		const room = this.room;
		const userId = Users.getCurrentUser()?.id;
		if (!room || !userId || !this.takeCooldown(userId)) return;
		const message: SoundboardPlayMessage = {
			hash: sound.hash,
			ext: sound.extension as EntranceSoundExtension,
			duration_ms: sound.durationMs,
		};
		void EntranceSoundPlaybackEngine.play({userId, hash: sound.hash, url: sound.url, durationMs: sound.durationMs});
		try {
			await room.localParticipant.publishData(TEXT_ENCODER.encode(JSON.stringify(message)), {
				reliable: true,
				topic: PROTOCOL_TOPIC,
			});
		} catch (error) {
			logger.warn('Failed to publish soundboard play', {error});
		}
	}

	private handleMessage(participant: Participant, payload: Uint8Array): void {
		const {userId} = parseVoiceParticipantIdentity(participant.identity);
		if (!userId) return;
		const message = parseMessage(payload);
		if (!message) {
			logger.debug('Ignoring malformed soundboard message', {identity: participant.identity});
			return;
		}
		if (!this.takeCooldown(userId)) return;
		const url = `${RuntimeConfig.mediaEndpoint}/entrance-sounds/${userId}/${message.hash}.${message.ext}`;
		void EntranceSoundPlaybackEngine.play({userId, hash: message.hash, url, durationMs: message.duration_ms});
	}

	private takeCooldown(userId: string): boolean {
		const now = Date.now();
		const last = this.lastPlayAt.get(userId);
		if (last !== undefined && now - last < PLAY_COOLDOWN_MS) return false;
		this.lastPlayAt.set(userId, now);
		return true;
	}
}

function parseMessage(payload: Uint8Array): SoundboardPlayMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(TEXT_DECODER.decode(payload));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const {hash, ext, duration_ms: durationMs} = parsed as Record<string, unknown>;
	if (typeof hash !== 'string' || !HASH_PATTERN.test(hash)) return null;
	if (!ENTRANCE_SOUND_EXTENSIONS.includes(ext as EntranceSoundExtension)) return null;
	if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) return null;
	return {hash, ext: ext as EntranceSoundExtension, duration_ms: Math.min(durationMs, ENTRANCE_SOUND_MAX_DURATION_MS)};
}

export default new Soundboard();
