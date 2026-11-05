// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {botAction} from './bot.mjs';
import {
	cardStrength,
	createGame,
	decideEleven,
	handWinner,
	manilhaRank,
	play,
	raise,
	respond,
	startHand,
	viewFor,
} from './engine.mjs';

const c = (rank, suit = 'ouros') => ({rank, suit});

function setHand(game, cards, vira = c('7')) {
	Object.assign(game.hand, {cards, vira, manilha: manilhaRank(vira)});
	return game;
}

function fourPlayers(cards, vira) {
	const game = createGame({players: 4, random: () => 0.5});
	game.hand.starter = 0;
	game.hand.turn = 0;
	return setHand(game, cards, vira);
}

function playAll(game, seats) {
	for (const seat of seats) assert.equal(play(game, seat, 0), null);
}

describe('cartas', () => {
	it('tem 40 cartas e distribui 3 para cada, sem repetir', () => {
		for (const players of [4, 6]) {
			const {hand} = createGame({players});
			const all = [...hand.cards.flat(), hand.vira].map((card) => `${card.rank}${card.suit}`);
			assert.equal(new Set(all).size, players * 3 + 1);
			assert.ok(hand.cards.every((cards) => cards.length === 3));
		}
	});

	it('a manilha é a carta seguinte à vira, e depois do 3 vem o 4', () => {
		assert.equal(manilhaRank(c('7')), 'Q');
		assert.equal(manilhaRank(c('3')), '4');
		assert.equal(manilhaRank(c('Q')), 'J');
	});

	it('zap vence copas, espadilha e pica-fumo, e qualquer manilha vence o 3', () => {
		const strength = (suit) => cardStrength(c('4', suit), '4');
		assert.ok(strength('paus') > strength('copas'));
		assert.ok(strength('copas') > strength('espadas'));
		assert.ok(strength('espadas') > strength('ouros'));
		assert.ok(strength('ouros') > cardStrength(c('3'), '4'));
	});
});

describe('quem leva a mão', () => {
	const cases = [
		[[0, 0], 0],
		[[0, 1], null],
		[[0, 1, 1], 1],
		[[0, 1, 0], 0],
		[[0, 'tie'], 0],
		[[0, 1, 'tie'], 0],
		[['tie', 1], 1],
		[['tie', 'tie'], null],
		[['tie', 'tie', 1], 1],
		[['tie', 'tie', 'tie'], 1],
	];
	for (const [results, expected] of cases) {
		it(`${JSON.stringify(results)} -> ${expected}`, () => assert.equal(handWinner(results, 1), expected));
	}
});

describe('jogadas', () => {
	const cards = () => [
		[c('3'), c('2'), c('A')],
		[c('4'), c('5'), c('6')],
		[c('K'), c('K', 'copas'), c('K', 'paus')],
		[c('5', 'copas'), c('6', 'copas'), c('7', 'copas')],
	];

	it('duas vazas ganham a mão e valem 1 ponto', () => {
		const game = fourPlayers(cards());
		playAll(game, [0, 1, 2, 3]);
		assert.equal(game.hand.turn, 0);
		playAll(game, [0, 1, 2, 3]);
		assert.deepEqual(game.score, [1, 0]);
		assert.equal(game.hand.phase, 'ended');
	});

	it('só joga quem é da vez', () => {
		const game = fourPlayers(cards());
		assert.equal(play(game, 1, 0), 'not-your-turn');
	});

	it('não deixa jogar encoberta na primeira vaza, e encoberta perde depois', () => {
		const game = fourPlayers([[c('3'), c('3', 'copas')], [c('4'), c('5')], [c('K'), c('4', 'copas')], [c('5'), c('6')]]);
		assert.equal(play(game, 0, 0, true), 'cannot-hide-first-trick');
		playAll(game, [0, 1, 2, 3]);
		assert.equal(play(game, 0, 0, true), null);
		playAll(game, [1, 2, 3]);
		assert.equal(game.hand.results[1], 1);
	});

	it('empate entre parceiros não é empate', () => {
		const game = fourPlayers([[c('3')], [c('4')], [c('3', 'copas')], [c('5')]]);
		playAll(game, [0, 1, 2, 3]);
		assert.equal(game.hand.results[0], 0);
	});

	it('funciona com 6 jogadores', () => {
		const game = createGame({players: 6, random: () => 0.5});
		const seats = [0, 1, 2, 3, 4, 5].map((n) => (game.hand.starter + n) % 6);
		for (const seat of seats) assert.equal(play(game, seat, 0), null);
		assert.equal(game.hand.results.length, 1);
	});
});

describe('truco', () => {
	const cards = () => [[c('3')], [c('4')], [c('2')], [c('5')]];

	it('correr entrega o valor atual, e aceitar vale o pedido', () => {
		const ran = fourPlayers(cards());
		assert.equal(raise(ran, 0), null);
		assert.equal(respond(ran, 1, 'run'), null);
		assert.deepEqual(ran.score, [1, 0]);
		const accepted = fourPlayers(cards());
		raise(accepted, 0);
		assert.equal(respond(accepted, 3, 'accept'), null);
		assert.equal(accepted.hand.value, 3);
	});

	it('só o time adversário responde', () => {
		const game = fourPlayers(cards());
		raise(game, 0);
		assert.equal(respond(game, 2, 'accept'), 'not-your-answer');
	});

	it('quem aumenta e depois corre entrega o valor aceito', () => {
		const game = fourPlayers(cards());
		raise(game, 0);
		assert.equal(respond(game, 1, 'raise'), null);
		assert.equal(game.hand.raise.proposed, 6);
		assert.equal(respond(game, 0, 'run'), null);
		assert.deepEqual(game.score, [0, 3]);
	});

	it('o mesmo time não pede de novo, mas o outro pode subir até 12', () => {
		const game = fourPlayers([[c('3'), c('2')], [c('4'), c('5')], [c('2'), c('3')], [c('5'), c('4')]]);
		raise(game, 0);
		respond(game, 1, 'accept');
		assert.equal(raise(game, 0), 'cannot-raise');
		playAll(game, [0]);
		assert.equal(raise(game, 1), null);
		respond(game, 0, 'raise');
		respond(game, 1, 'raise');
		assert.equal(game.hand.raise.proposed, 12);
		assert.equal(respond(game, 0, 'raise'), 'invalid-answer');
		respond(game, 0, 'accept');
		assert.equal(game.hand.value, 12);
	});
});

describe('mão de onze e fim de jogo', () => {
	it('o time com 11 decide: joga valendo 3 ou entrega 1', () => {
		const game = createGame({players: 4, random: () => 0.5});
		game.score = [11, 4];
		startHand(game);
		assert.equal(game.hand.phase, 'eleven');
		const {starter} = game.hand;
		assert.equal(play(game, starter, 0), 'not-your-turn');
		assert.equal(raise(game, starter), 'cannot-raise');
		assert.equal(decideEleven(game, 1, 'play'), 'not-your-answer');
		assert.equal(decideEleven(game, 0, 'play'), null);
		assert.equal(game.hand.value, 3);
		assert.equal(raise(game, game.hand.turn), 'cannot-raise');
		const other = createGame({players: 4, random: () => 0.5});
		other.score = [11, 4];
		startHand(other);
		decideEleven(other, 2, 'run');
		assert.deepEqual(other.score, [11, 5]);
	});

	it('na mão de onze o parceiro vê as cartas só antes de decidir', () => {
		const game = createGame({players: 4, random: () => 0.5});
		game.score = [11, 4];
		startHand(game);
		assert.equal(viewFor(game, 0).partners.length, 1);
		assert.equal(viewFor(game, 1).partners.length, 0);
		decideEleven(game, 0, 'play');
		assert.equal(viewFor(game, 0).partners.length, 0);
	});

	it('mão de ferro: 11 a 11 joga no escuro, sem truco', () => {
		const game = createGame({players: 4, random: () => 0.5});
		game.score = [11, 11];
		startHand(game);
		assert.equal(game.hand.phase, 'play');
		assert.ok(viewFor(game, 0).hand.every((card) => card === null));
		assert.equal(raise(game, game.hand.turn), 'cannot-raise');
	});

	it('12 pontos encerram o jogo', () => {
		const game = fourPlayers([[c('3')], [c('4')], [c('2')], [c('5')]]);
		game.score = [10, 0];
		game.hand.value = 3;
		game.hand.results = [0];
		game.hand.tricks = [{plays: [], result: 0}];
		playAll(game, [0, 1, 2, 3]);
		assert.equal(game.winner, 0);
	});
});

describe('sigilo', () => {
	it('a visão de um jogador não contém cartas dos outros', () => {
		const game = createGame({players: 6, random: () => 0.5});
		const secret = game.hand.cards[1].map((card) => `"rank":"${card.rank}","suit":"${card.suit}"`);
		const text = JSON.stringify({...viewFor(game, 0), vira: null, hand: null});
		for (const card of secret) assert.ok(!text.includes(card));
		assert.ok(!JSON.stringify(viewFor(game, null)).includes('"hand":[{'));
	});

	it('carta encoberta não aparece na mesa', () => {
		const game = fourPlayers([[c('3'), c('2')], [c('4'), c('5')], [c('2'), c('3')], [c('5'), c('4')]]);
		playAll(game, [0, 1, 2, 3]);
		play(game, 0, 0, true);
		assert.equal(viewFor(game, 1).table[0].card, null);
	});
});

describe('bots', () => {
	it('jogam partidas inteiras até alguém fazer 12, com 4 e 6 jogadores', () => {
		for (const players of [4, 6]) {
			for (let round = 0; round < 200; round++) {
				const game = createGame({players});
				for (let steps = 0; game.winner === null; steps++) {
					assert.ok(steps < 20000, 'partida não terminou');
					const {hand} = game;
					if (hand.phase === 'ended') {
						startHand(game);
						continue;
					}
					let seat = hand.turn;
					if (hand.phase === 'eleven') seat = hand.elevenTeam;
					if (hand.phase === 'raise') seat = hand.raise.awaiting;
					const action = botAction(game, seat);
					let error;
					if (action.type === 'play') error = play(game, seat, action.index, action.hidden);
					if (action.type === 'raise') error = raise(game, seat);
					if (action.type === 'respond') error = respond(game, seat, action.answer);
					if (action.type === 'eleven') error = decideEleven(game, seat, action.answer);
					assert.equal(error, null, JSON.stringify(action));
				}
				assert.ok(game.score[game.winner] >= 12);
			}
		}
	});
});
