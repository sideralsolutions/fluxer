// SPDX-License-Identifier: AGPL-3.0-or-later

import AppStorage from '@app/features/platform/state/PersistentStorage';
import {Logger} from '@app/features/platform/utils/AppLogger';
import StreamerMode from '@app/features/streamer_mode/state/StreamerMode';
import Sound from '@app/features/ui/state/Sound';
import type {TrucoSound} from '@app/features/voice/components/TrucoEvents';
import {getEffectiveAudioState} from '@app/features/voice/engine/VoiceEffectiveAudioState';
import {resolveAudioContextConstructor} from '@app/features/voice/engine/VoiceSharedAudioContext';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';

const logger = new Logger('TrucoSounds');

const MUTED_STORAGE_KEY = 'fluxer:truco:muted';
const MAX_MASTER_VOLUME_PERCENT = 200;
const TABLE_VOLUME = 0.6;
const CARDS_PER_PLAYER = 3;
export const DEAL_STEP_MS = 70;

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

function tone(context: BaseAudioContext, output: AudioNode, options: ToneOptions): void {
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

function noise(context: BaseAudioContext, output: AudioNode, {at, frequency, duration, volume}: NoiseOptions): void {
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

// Os sons são sintetizados aqui mesmo, sem arquivos. O atraso espera a animação chegar ao ponto certo.
export function scheduleTrucoSound(
	context: BaseAudioContext,
	output: AudioNode,
	sound: TrucoSound,
	players: number,
	start: number,
): void {
	const notes = (frequencies: Array<number>, at: number, step: number, duration: number, volume: number) => {
		frequencies.forEach((frequency, index) => {
			tone(context, output, {at: at + index * step, frequency, duration, volume, type: 'triangle'});
		});
	};
	switch (sound) {
		case 'deal':
			for (let card = 0; card < players * CARDS_PER_PLAYER; card++) {
				const at = start + (card * DEAL_STEP_MS) / 1000;
				noise(context, output, {at, frequency: 3400, duration: 0.05, volume: 0.9});
			}
			break;
		case 'card':
			noise(context, output, {at: start + 0.24, frequency: 1500, duration: 0.08, volume: 1});
			tone(context, output, {at: start + 0.24, frequency: 190, slideTo: 80, duration: 0.09, volume: 0.45});
			break;
		case 'trickWon':
			notes([659, 880], start + 0.5, 0.1, 0.3, 0.42);
			break;
		case 'trickLost':
			notes([392, 311], start + 0.5, 0.13, 0.32, 0.38);
			break;
		case 'trickTied':
			notes([440, 440], start + 0.5, 0.13, 0.16, 0.34);
			break;
		case 'truco':
			tone(context, output, {at: start, frequency: 130, slideTo: 42, duration: 0.3, volume: 0.7});
			for (const at of [start, start + 0.17]) {
				for (const frequency of [196, 247, 294, 392]) {
					tone(context, output, {at, frequency, duration: 0.34, volume: 0.13, type: 'sawtooth', lowpass: 1900});
				}
			}
			break;
		case 'accept':
			notes([523, 784], start, 0.08, 0.2, 0.4);
			break;
		case 'run':
			tone(context, output, {at: start, frequency: 440, slideTo: 150, duration: 0.42, volume: 0.45, type: 'triangle'});
			break;
		case 'points':
			for (let chip = 0; chip < 5; chip++) {
				const at = start + 0.45 + chip * 0.055 + (chip % 2) * 0.012;
				noise(context, output, {at, frequency: 5200, duration: 0.03, volume: 0.8});
				tone(context, output, {at, frequency: 2300 + chip * 130, duration: 0.05, volume: 0.07, type: 'square'});
			}
			break;
		case 'yourTurn':
			tone(context, output, {at: start + 0.9, frequency: 988, duration: 0.5, volume: 0.34});
			tone(context, output, {at: start + 0.9, frequency: 1976, duration: 0.3, volume: 0.12});
			break;
		case 'gameWon':
			notes([523, 659, 784, 1047], start + 0.5, 0.12, 0.34, 0.36);
			notes([523, 659, 784], start + 1, 0, 0.9, 0.16);
			break;
		case 'gameLost':
			notes([392, 349, 311, 262], start + 0.5, 0.2, 0.46, 0.4);
			break;
	}
}

class TrucoSounds {
	private context: AudioContext | null = null;
	private sinkId = '';

	get muted(): boolean {
		return AppStorage.getItem(MUTED_STORAGE_KEY) === '1';
	}

	set muted(muted: boolean) {
		AppStorage.setItem(MUTED_STORAGE_KEY, muted ? '1' : '0');
	}

	private ensureContext(): AudioContext | null {
		if (!this.context) {
			const Context = resolveAudioContextConstructor();
			if (!Context) return null;
			this.context = new Context({latencyHint: 'interactive'});
		}
		if (this.context.state === 'suspended') {
			void this.context.resume().catch((error) => logger.debug('Truco AudioContext resume rejected', {error}));
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
		void sinkable.setSinkId(sinkId).catch((error) => logger.debug('Failed to apply truco output device', {error}));
	}

	play(sounds: Array<TrucoSound>, players: number): void {
		if (sounds.length === 0 || this.muted) return;
		if (!Sound.getSoundEnabled() || StreamerMode.shouldDisableSounds || getEffectiveAudioState().effectiveDeaf) return;
		const context = this.ensureContext();
		if (!context) return;
		this.applyOutputDevice(context);
		const master = Math.max(0, Math.min(MAX_MASTER_VOLUME_PERCENT, Sound.getMasterVolume())) / 100;
		const gain = context.createGain();
		gain.gain.value = TABLE_VOLUME * master * (VoiceSettings.getOutputVolume() / 100);
		gain.connect(context.destination);
		for (const sound of sounds) scheduleTrucoSound(context, gain, sound, players, context.currentTime);
	}
}

export default new TrucoSounds();
