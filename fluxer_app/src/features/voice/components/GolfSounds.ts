// SPDX-License-Identifier: AGPL-3.0-or-later

import {GameSynth, noise, tone} from '@app/features/voice/components/GameSynth';
import type {GolfPhaseSound} from '@app/features/voice/components/GolfEvents';

export type GolfBallSound =
	| 'hit'
	| 'wall'
	| 'obstacle'
	| 'bumper'
	| 'ball'
	| 'land'
	| 'jump'
	| 'boost'
	| 'portal'
	| 'water'
	| 'lava'
	| 'fall'
	| 'sink';
export type GolfSound = GolfBallSound | GolfPhaseSound | 'tick';

const synth = new GameSynth('fluxer:golf:muted');

// Todos os sons são sintetizados, sem arquivos. A força vai de 0 a 1 e muda o peso de cada batida.
export function scheduleGolfSound(
	context: BaseAudioContext,
	output: AudioNode,
	sound: GolfSound,
	strength: number,
	start: number,
): void {
	const notes = (frequencies: Array<number>, at: number, step: number, duration: number, volume: number) => {
		frequencies.forEach((frequency, index) => {
			tone(context, output, {at: at + index * step, frequency, duration, volume, type: 'triangle'});
		});
	};
	switch (sound) {
		case 'hit':
			noise(context, output, {at: start, frequency: 2600, duration: 0.05, volume: 0.5 + strength * 0.6});
			tone(context, output, {
				at: start,
				frequency: 520 + strength * 260,
				slideTo: 170,
				duration: 0.09,
				volume: 0.3 + strength * 0.35,
			});
			break;
		case 'wall':
			noise(context, output, {at: start, frequency: 900, duration: 0.05, volume: 0.35 + strength * 0.6});
			tone(context, output, {at: start, frequency: 240, slideTo: 120, duration: 0.08, volume: 0.25 + strength * 0.35});
			break;
		case 'obstacle':
			tone(context, output, {at: start, frequency: 880, duration: 0.22, volume: 0.26, type: 'square', lowpass: 2600});
			tone(context, output, {at: start, frequency: 1327, duration: 0.3, volume: 0.16, type: 'square', lowpass: 3200});
			break;
		case 'bumper':
			tone(context, output, {at: start, frequency: 240, slideTo: 980, duration: 0.15, volume: 0.42, type: 'triangle'});
			tone(context, output, {at: start + 0.05, frequency: 620, slideTo: 1400, duration: 0.12, volume: 0.18});
			break;
		case 'ball':
			noise(context, output, {at: start, frequency: 4200, duration: 0.03, volume: 0.5 + strength * 0.5});
			tone(context, output, {at: start, frequency: 1900, duration: 0.05, volume: 0.22});
			break;
		case 'land':
			tone(context, output, {at: start, frequency: 150, slideTo: 60, duration: 0.12, volume: 0.3 + strength * 0.35});
			noise(context, output, {at: start, frequency: 700, duration: 0.06, volume: 0.3 + strength * 0.4});
			break;
		case 'jump':
			tone(context, output, {at: start, frequency: 170, slideTo: 880, duration: 0.3, volume: 0.42, type: 'triangle'});
			tone(context, output, {
				at: start + 0.02,
				frequency: 340,
				slideTo: 1320,
				duration: 0.24,
				volume: 0.14,
				type: 'square',
				lowpass: 2400,
			});
			break;
		case 'boost':
			noise(context, output, {at: start, frequency: 1400, duration: 0.5, volume: 0.9});
			tone(context, output, {
				at: start,
				frequency: 220,
				slideTo: 1100,
				duration: 0.42,
				volume: 0.24,
				type: 'sawtooth',
				lowpass: 2400,
			});
			break;
		case 'portal':
			for (const [index, frequency] of [330, 494, 740, 1109].entries()) {
				tone(context, output, {
					at: start + index * 0.06,
					frequency,
					slideTo: frequency * 1.5,
					duration: 0.2,
					volume: 0.22,
				});
			}
			break;
		case 'water':
			noise(context, output, {at: start, frequency: 520, duration: 0.42, volume: 1.2});
			noise(context, output, {at: start + 0.09, frequency: 1500, duration: 0.3, volume: 0.6});
			tone(context, output, {at: start, frequency: 240, slideTo: 90, duration: 0.2, volume: 0.3});
			break;
		case 'lava':
			noise(context, output, {at: start, frequency: 3800, duration: 0.7, volume: 1.1});
			tone(context, output, {
				at: start,
				frequency: 120,
				slideTo: 55,
				duration: 0.4,
				volume: 0.4,
				type: 'sawtooth',
				lowpass: 700,
			});
			break;
		case 'fall':
			tone(context, output, {at: start, frequency: 900, slideTo: 130, duration: 0.6, volume: 0.32, type: 'triangle'});
			break;
		case 'sink':
			for (const at of [0, 0.07, 0.15]) {
				noise(context, output, {at: start + at, frequency: 3000, duration: 0.03, volume: 0.7});
				tone(context, output, {at: start + at, frequency: 1250 - at * 1500, duration: 0.05, volume: 0.2});
			}
			notes([784, 1047, 1319], start + 0.26, 0.09, 0.42, 0.34);
			break;
		case 'tick':
			tone(context, output, {at: start, frequency: 660, duration: 0.14, volume: 0.36});
			break;
		case 'go':
			tone(context, output, {at: start, frequency: 1047, duration: 0.42, volume: 0.42});
			tone(context, output, {at: start, frequency: 1568, duration: 0.3, volume: 0.16});
			break;
		case 'holeEnd':
			notes([523, 659, 784], start, 0.1, 0.32, 0.34);
			break;
		case 'eliminated':
			notes([392, 349, 311, 233], start, 0.17, 0.42, 0.42);
			tone(context, output, {
				at: start + 0.68,
				frequency: 98,
				slideTo: 55,
				duration: 0.6,
				volume: 0.4,
				type: 'sawtooth',
				lowpass: 500,
			});
			break;
		case 'won':
			notes([523, 659, 784, 1047], start, 0.12, 0.34, 0.38);
			notes([523, 659, 784, 1047], start + 0.55, 0, 1, 0.18);
			break;
		case 'lost':
			notes([392, 349, 311, 262], start, 0.2, 0.46, 0.38);
			break;
	}
}

export default {
	get muted(): boolean {
		return synth.muted;
	},
	set muted(muted: boolean) {
		synth.muted = muted;
	},
	play(sound: GolfSound, strength = 1, volume = 1): void {
		synth.play((context, output, start) => scheduleGolfSound(context, output, sound, strength, start), volume);
	},
};
