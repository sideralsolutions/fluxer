// SPDX-License-Identifier: AGPL-3.0-or-later

import AppStorage from '@app/features/platform/state/PersistentStorage';
import {Logger} from '@app/features/platform/utils/AppLogger';
import StreamerMode from '@app/features/streamer_mode/state/StreamerMode';
import Sound from '@app/features/ui/state/Sound';
import {getEffectiveAudioState} from '@app/features/voice/engine/VoiceEffectiveAudioState';
import {resolveAudioContextConstructor} from '@app/features/voice/engine/VoiceSharedAudioContext';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';

const logger = new Logger('GameSynth');

const MAX_MASTER_VOLUME_PERCENT = 200;
const TABLE_VOLUME = 0.6;

interface ToneOptions {
	at: number;
	frequency: number;
	slideTo?: number;
	duration: number;
	volume: number;
	type?: OscillatorType;
	lowpass?: number;
}

interface NoiseOptions {
	at: number;
	frequency: number;
	duration: number;
	volume: number;
}

export function tone(context: BaseAudioContext, output: AudioNode, options: ToneOptions): void {
	const {at, frequency, slideTo, duration, volume, type = 'sine', lowpass} = options;
	const oscillator = context.createOscillator();
	oscillator.type = type;
	oscillator.frequency.setValueAtTime(frequency, at);
	if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, at + duration);
	const gain = context.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(volume, at + 0.008);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
	oscillator.connect(gain);
	if (lowpass) {
		const filter = context.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = lowpass;
		gain.connect(filter).connect(output);
	} else {
		gain.connect(output);
	}
	oscillator.start(at);
	oscillator.stop(at + duration + 0.02);
}

export function noise(context: BaseAudioContext, output: AudioNode, options: NoiseOptions): void {
	const {at, frequency, duration, volume} = options;
	const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
	const samples = buffer.getChannelData(0);
	for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 2;
	const source = context.createBufferSource();
	source.buffer = buffer;
	const filter = context.createBiquadFilter();
	filter.type = 'bandpass';
	filter.frequency.value = frequency;
	filter.Q.value = 0.9;
	const gain = context.createGain();
	gain.gain.value = volume;
	source.connect(filter).connect(gain).connect(output);
	source.start(at);
}

type Schedule = (context: BaseAudioContext, output: AudioNode, start: number) => void;

// Saída de áudio dos jogos da chamada: respeita o som desligado, o dispositivo de saída e o botão de silenciar do jogo.
export class GameSynth {
	private context: AudioContext | null = null;
	private sinkId = '';

	constructor(private readonly mutedStorageKey: string) {}

	get muted(): boolean {
		return AppStorage.getItem(this.mutedStorageKey) === '1';
	}

	set muted(muted: boolean) {
		AppStorage.setItem(this.mutedStorageKey, muted ? '1' : '0');
	}

	private ensureContext(): AudioContext | null {
		if (!this.context) {
			const Context = resolveAudioContextConstructor();
			if (!Context) return null;
			this.context = new Context({latencyHint: 'interactive'});
		}
		if (this.context.state === 'suspended') {
			void this.context.resume().catch((error) => logger.debug('Game AudioContext resume rejected', {error}));
		}
		return this.context;
	}

	private applyOutputDevice(context: AudioContext): void {
		const deviceId = VoiceSettings.getOutputDeviceId();
		const sinkId = !deviceId || deviceId === 'default' ? '' : deviceId;
		if (sinkId === this.sinkId) return;
		const sinkable = context as AudioContext & {setSinkId?: (sinkId: string) => Promise<void>};
		if (typeof sinkable.setSinkId !== 'function') return;
		this.sinkId = sinkId;
		void sinkable.setSinkId(sinkId).catch((error) => logger.debug('Failed to apply game output device', {error}));
	}

	play(schedule: Schedule, volume = 1): void {
		if (this.muted) return;
		if (!Sound.getSoundEnabled() || StreamerMode.shouldDisableSounds || getEffectiveAudioState().effectiveDeaf) return;
		const context = this.ensureContext();
		if (!context) return;
		this.applyOutputDevice(context);
		const master = Math.max(0, Math.min(MAX_MASTER_VOLUME_PERCENT, Sound.getMasterVolume())) / 100;
		const gain = context.createGain();
		gain.gain.value = TABLE_VOLUME * volume * master * (VoiceSettings.getOutputVolume() / 100);
		gain.connect(context.destination);
		schedule(context, gain, context.currentTime);
	}
}
