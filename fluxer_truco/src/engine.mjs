// SPDX-License-Identifier: AGPL-3.0-or-later

// Regras do truco paulista para 4 (2x2) ou 6 (3x3) jogadores. O time de um assento é assento % 2.
// Módulo puro: quem chama decide quando agir, e o embaralhamento pode ser injetado nos testes.

export const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'];
export const SUITS = ['ouros', 'espadas', 'copas', 'paus'];
export const WINNING_SCORE = 12;
const NEXT_VALUE = {1: 3, 3: 6, 6: 9, 9: 12};
const HAND_SIZE = 3;

export const teamOf = (seat) => seat % 2;
const otherTeam = (team) => 1 - team;

function shuffledDeck(random) {
	const deck = RANKS.flatMap((rank) => SUITS.map((suit) => ({rank, suit})));
	for (let i = deck.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[deck[i], deck[j]] = [deck[j], deck[i]];
	}
	return deck;
}

export function manilhaRank(vira) {
	return RANKS[(RANKS.indexOf(vira.rank) + 1) % RANKS.length];
}

export function cardStrength(card, manilha) {
	if (card.rank === manilha) return 100 + SUITS.indexOf(card.suit);
	return RANKS.indexOf(card.rank);
}

const playStrength = (play, manilha) => (play.hidden ? -1 : cardStrength(play.card, manilha));

export function createGame({players, random = Math.random}) {
	if (players !== 4 && players !== 6) throw new Error('players must be 4 or 6');
	const game = {players, random, score: [0, 0], dealer: players - 1, hand: null, winner: null};
	startHand(game);
	return game;
}

export function startHand(game) {
	game.dealer = (game.dealer + 1) % game.players;
	const deck = shuffledDeck(game.random);
	const cards = Array.from({length: game.players}, () => deck.splice(0, HAND_SIZE));
	const vira = deck.pop();
	const starter = (game.dealer + 1) % game.players;
	const atEleven = [0, 1].filter((team) => game.score[team] === WINNING_SCORE - 1);
	game.hand = {
		cards,
		vira,
		manilha: manilhaRank(vira),
		starter,
		turn: starter,
		value: 1,
		lastRaiser: null,
		raise: null,
		tricks: [],
		table: [],
		results: [],
		phase: atEleven.length === 1 ? 'eleven' : 'play',
		elevenTeam: atEleven.length === 1 ? atEleven[0] : null,
		blind: atEleven.length === 2,
		noRaises: atEleven.length > 0,
		ended: null,
	};
}

// Com 'tie' no resultado: quem ganhou a primeira leva o empate seguinte, e empate na primeira decide na próxima vaza.
export function handWinner(results, starterTeam) {
	const [first, second, third] = results;
	if (second === undefined) return null;
	if (first === 'tie') {
		if (second !== 'tie') return second;
		if (third === undefined) return null;
		return third === 'tie' ? starterTeam : third;
	}
	if (second === first || second === 'tie') return first;
	if (third === undefined) return null;
	return third === 'tie' ? first : third;
}

function resolveTrick(game) {
	const {hand} = game;
	const best = Math.max(...hand.table.map((play) => playStrength(play, hand.manilha)));
	const top = hand.table.filter((play) => playStrength(play, hand.manilha) === best);
	const teams = new Set(top.map((play) => teamOf(play.seat)));
	const result = teams.size === 1 ? [...teams][0] : 'tie';
	hand.tricks.push({plays: hand.table, result});
	hand.results.push(result);
	hand.table = [];
	hand.turn = top[0].seat;
	const winner = handWinner(hand.results, teamOf(hand.starter));
	if (winner !== null) endHand(game, winner, hand.value, 'tricks');
}

function endHand(game, team, points, reason) {
	game.score[team] += points;
	game.hand.phase = 'ended';
	game.hand.ended = {team, points, reason};
	if (game.score[team] >= WINNING_SCORE) game.winner = team;
}

export function play(game, seat, index, hidden = false) {
	const {hand} = game;
	if (hand.phase !== 'play' || hand.turn !== seat) return 'not-your-turn';
	const card = hand.cards[seat][index];
	if (!card) return 'invalid-card';
	if (hidden && hand.tricks.length === 0) return 'cannot-hide-first-trick';
	hand.cards[seat] = hand.cards[seat].filter((_, i) => i !== index);
	hand.table.push({seat, card, hidden: Boolean(hidden)});
	if (hand.table.length === game.players) {
		resolveTrick(game);
	} else {
		hand.turn = (hand.turn + 1) % game.players;
	}
	return null;
}

export function canRaise(game, seat) {
	const {hand} = game;
	return (
		hand.phase === 'play' &&
		hand.turn === seat &&
		!hand.noRaises &&
		hand.value < WINNING_SCORE &&
		hand.lastRaiser !== teamOf(seat)
	);
}

export function raise(game, seat) {
	if (!canRaise(game, seat)) return 'cannot-raise';
	const {hand} = game;
	const team = teamOf(seat);
	hand.raise = {by: team, seat, proposed: NEXT_VALUE[hand.value], awaiting: otherTeam(team)};
	hand.phase = 'raise';
	return null;
}

// Aumentar de volta aceita o valor pedido: quem pediu e corre entrega esse valor.
export function respond(game, seat, answer) {
	const {hand} = game;
	if (hand.phase !== 'raise' || hand.raise.awaiting !== teamOf(seat)) return 'not-your-answer';
	const {by, proposed} = hand.raise;
	if (answer === 'run') {
		hand.raise = null;
		endHand(game, by, hand.value, 'run');
		return null;
	}
	if (answer === 'accept') {
		hand.value = proposed;
		hand.lastRaiser = by;
		hand.raise = null;
		hand.phase = 'play';
		return null;
	}
	if (answer === 'raise' && proposed < WINNING_SCORE) {
		const team = teamOf(seat);
		hand.value = proposed;
		hand.lastRaiser = by;
		hand.raise = {by: team, seat, proposed: NEXT_VALUE[proposed], awaiting: by};
		return null;
	}
	return 'invalid-answer';
}

export function decideEleven(game, seat, answer) {
	const {hand} = game;
	if (hand.phase !== 'eleven' || hand.elevenTeam !== teamOf(seat)) return 'not-your-answer';
	if (answer === 'play') {
		hand.value = 3;
		hand.phase = 'play';
		return null;
	}
	if (answer === 'run') {
		endHand(game, otherTeam(hand.elevenTeam), 1, 'run');
		return null;
	}
	return 'invalid-answer';
}

// O que um assento pode ver. Cartas alheias nunca saem daqui, exceto a do parceiro na mão de onze.
export function viewFor(game, seat) {
	const {hand} = game;
	const seesPartners = hand.phase === 'eleven' && seat !== null && hand.elevenTeam === teamOf(seat);
	const showPlay = (play) => ({seat: play.seat, hidden: play.hidden, card: play.hidden ? null : play.card});
	const own = seat === null ? [] : hand.cards[seat];
	return {
		players: game.players,
		score: game.score,
		winner: game.winner,
		dealer: game.dealer,
		vira: hand.vira,
		manilha: hand.manilha,
		starter: hand.starter,
		turn: hand.turn,
		value: hand.value,
		phase: hand.phase,
		raise: hand.raise,
		elevenTeam: hand.elevenTeam,
		blind: hand.blind,
		ended: hand.ended,
		canRaise: seat !== null && canRaise(game, seat),
		canHide: hand.tricks.length > 0,
		trickResults: hand.results,
		lastTrick: hand.tricks.at(-1)?.plays.map(showPlay) ?? [],
		table: hand.table.map(showPlay),
		hand: hand.blind ? own.map(() => null) : own,
		cardCounts: hand.cards.map((cards) => cards.length),
		partners: seesPartners
			? hand.cards.flatMap((cards, other) => (other !== seat && teamOf(other) === teamOf(seat) ? [{seat: other, cards}] : []))
			: [],
	};
}
