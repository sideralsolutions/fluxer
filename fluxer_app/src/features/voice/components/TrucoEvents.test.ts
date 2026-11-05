// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {type GameView, type TableView, trucoSoundsBetween} from '@app/features/voice/components/TrucoEvents';

const play = (seat: number) => ({seat, hidden: false, card: {rank: 'A', suit: 'paus'}});

function game(overrides: Partial<GameView> = {}): GameView {
	return {
		players: 4,
		handNumber: 1,
		score: [0, 0],
		winner: null,
		vira: {rank: '4', suit: 'ouros'},
		manilha: '5',
		turn: 1,
		value: 1,
		phase: 'play',
		raise: null,
		elevenTeam: null,
		blind: false,
		ended: null,
		canRaise: false,
		canHide: false,
		trickResults: [],
		lastTrick: [],
		lastTrickWinner: null,
		table: [],
		hand: [],
		cardCounts: [3, 3, 3, 3],
		partners: [],
		...overrides,
	};
}

function table(overrides: Partial<GameView> | null, view: Partial<TableView> = {}): TableView {
	return {
		players: 4,
		seats: [],
		teamNames: ['', ''],
		turnMs: 30_000,
		you: 0,
		lastResult: null,
		game: overrides ? game(overrides) : null,
		actingSeat: 1,
		...view,
	};
}

const raise = {by: 1, seat: 1, proposed: 3, awaiting: 0};

test('opening the table mid game stays silent', () => {
	assert.deepEqual(trucoSoundsBetween(null, table({})), []);
});

test('a new hand deals, also when the game has just started', () => {
	assert.deepEqual(trucoSoundsBetween(table(null), table({})), ['deal']);
	assert.deepEqual(trucoSoundsBetween(table({}), table({handNumber: 2})), ['deal']);
});

test('a new hand that starts with you also calls you', () => {
	assert.deepEqual(trucoSoundsBetween(table({}, {actingSeat: 0}), table({handNumber: 2}, {actingSeat: 0})), [
		'deal',
		'yourTurn',
	]);
});

test('a played card makes noise and the turn reaching you calls you once', () => {
	const before = table({});
	const after = table({table: [play(1)]}, {actingSeat: 0});
	assert.deepEqual(trucoSoundsBetween(before, after), ['card', 'yourTurn']);
	assert.deepEqual(trucoSoundsBetween(after, after), []);
});

test('the card that closes a trick also tells who took it', () => {
	const before = table({table: [play(0), play(1), play(2)]});
	assert.deepEqual(trucoSoundsBetween(before, table({trickResults: [0]})), ['card', 'trickWon']);
	assert.deepEqual(trucoSoundsBetween(before, table({trickResults: [1]})), ['card', 'trickLost']);
	assert.deepEqual(trucoSoundsBetween(before, table({trickResults: ['tie']})), ['card', 'trickTied']);
});

test('a raise sounds again when it is raised back, and accepting closes it', () => {
	const raised = table({phase: 'raise', raise});
	assert.deepEqual(trucoSoundsBetween(table({}), raised), ['truco']);
	const raisedBack = table({phase: 'raise', raise: {...raise, proposed: 6}});
	assert.deepEqual(trucoSoundsBetween(raised, raisedBack), ['truco']);
	assert.deepEqual(trucoSoundsBetween(raised, table({value: 3})), ['accept']);
});

test('folding a raise ends the hand', () => {
	const raised = table({phase: 'raise', raise});
	const folded = table({phase: 'ended', ended: {team: 1, points: 1, reason: 'run'}});
	assert.deepEqual(trucoSoundsBetween(raised, folded), ['run', 'points']);
});

test('the last hand tells each team how the game went', () => {
	const ended = {team: 1, points: 3, reason: 'tricks'};
	const last = {phase: 'ended', ended, winner: 1} as const;
	assert.deepEqual(trucoSoundsBetween(table({}), table(last)), ['gameLost']);
	assert.deepEqual(trucoSoundsBetween(table({}, {you: 1}), table(last, {you: 1})), ['gameWon']);
});

test('someone watching hears every result as good news', () => {
	const before = table({}, {you: null});
	assert.deepEqual(trucoSoundsBetween(before, table({trickResults: [1]}, {you: null})), ['card', 'trickWon']);
});
