// SPDX-License-Identifier: AGPL-3.0-or-later

import {GameSynth, noise, tone} from '@app/features/voice/components/GameSynth';
import type {TrucoSound} from '@app/features/voice/components/TrucoEvents';

const CARDS_PER_PLAYER = 3;
export const DEAL_STEP_MS = 70;

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

const synth = new GameSynth('fluxer:truco:muted');

export default {
	get muted(): boolean {
		return synth.muted;
	},
	set muted(muted: boolean) {
		synth.muted = muted;
	},
	play(sounds: Array<TrucoSound>, players: number): void {
		if (sounds.length === 0) return;
		synth.play((context, output, start) => {
			for (const sound of sounds) scheduleTrucoSound(context, output, sound, players, start);
		});
	},
};
