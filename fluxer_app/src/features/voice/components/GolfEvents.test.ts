// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {type GolfPlayer, type GolfView, golfPhaseSounds} from '@app/features/voice/components/GolfEvents';

const player = (name: string, out = false): GolfPlayer => ({
	name,
	userId: name,
	bot: false,
	online: true,
	total: 0,
	points: 0,
	out,
	strokes: 0,
	done: false,
});

function view(overrides: Partial<GolfView>): GolfView {
	return {
		phase: 'hole',
		mode: 'classic',
		holeCount: 3,
		holeIndex: 0,
		you: 0,
		timer: 0,
		deadline: null,
		courseName: null,
		holeResult: null,
		lastResult: null,
		players: [player('Ana'), player('Bia')],
		...overrides,
	};
}

test('abrir no meio e repetir a fase ficam em silêncio', () => {
	assert.deepEqual(golfPhaseSounds(null, view({})), []);
	assert.deepEqual(golfPhaseSounds(view({}), view({})), []);
});

test('o fim da contagem dá a largada', () => {
	assert.deepEqual(golfPhaseSounds(view({phase: 'countdown'}), view({phase: 'hole'})), ['go']);
});

test('quem acabou de sair do torneio ouve a eliminação, os outros o fim da pista', () => {
	const after = view({phase: 'holeEnd', players: [player('Ana', true), player('Bia')]});
	assert.deepEqual(golfPhaseSounds(view({}), after), ['eliminated']);
	assert.deepEqual(golfPhaseSounds(view({you: 1}), {...after, you: 1}), ['holeEnd']);
});

test('o fim da partida separa quem ganhou de quem perdeu', () => {
	const lastResult = {
		mode: 'classic' as const,
		ranking: [
			{name: 'Bia', total: 9, points: 0},
			{name: 'Ana', total: 12, points: 0},
		],
	};
	assert.deepEqual(golfPhaseSounds(view({}), view({phase: 'results', lastResult})), ['lost']);
	assert.deepEqual(golfPhaseSounds(view({you: 1}), view({you: 1, phase: 'results', lastResult})), ['won']);
});
