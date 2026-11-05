// SPDX-License-Identifier: AGPL-3.0-or-later

import {canRaise, cardStrength, RANKS, teamOf} from './engine.mjs';

// Nota de 0 a 1 para a mão: manilhas pesam mais, e blefe entra por sorteio em quem chama.
function handRating(cards, manilha) {
	if (cards.length === 0) return 0;
	const total = cards.reduce((sum, card) => {
		const strength = cardStrength(card, manilha);
		return sum + (strength >= 100 ? 1 + (strength - 100) * 0.15 : strength / (RANKS.length - 1));
	}, 0);
	return Math.min(1, total / cards.length);
}

function chooseCard(game, seat) {
	const {hand} = game;
	const cards = hand.cards[seat];
	if (hand.blind) return 0;
	const ranked = cards
		.map((card, index) => ({index, strength: cardStrength(card, hand.manilha)}))
		.sort((a, b) => a.strength - b.strength);
	const lowest = ranked[0].index;
	const plays = hand.table.map((play) => ({
		team: teamOf(play.seat),
		strength: play.hidden ? -1 : cardStrength(play.card, hand.manilha),
	}));
	if (plays.length === 0) {
		// Abre a primeira vaza com a carta do meio e guarda a maior.
		return hand.tricks.length === 0 ? ranked[Math.floor((ranked.length - 1) / 2)].index : ranked.at(-1).index;
	}
	const best = Math.max(...plays.map((play) => play.strength));
	const partnerLeads = plays.some((play) => play.strength === best && play.team === teamOf(seat));
	if (partnerLeads) return lowest;
	return (ranked.find((card) => card.strength > best) ?? ranked[0]).index;
}

export function botAction(game, seat) {
	const {hand} = game;
	const random = game.random;
	const cards = hand.cards[seat];
	if (hand.phase === 'eleven') {
		const team = hand.cards.flatMap((own, other) => (teamOf(other) === teamOf(seat) ? own : []));
		return {type: 'eleven', answer: handRating(team, hand.manilha) >= 0.55 ? 'play' : 'run'};
	}
	if (hand.phase === 'raise') {
		const rating = handRating(cards, hand.manilha) + (hand.results.includes(teamOf(seat)) ? 0.2 : 0);
		const needed = 0.45 + hand.raise.proposed * 0.02;
		if (rating >= needed + 0.3 && hand.raise.proposed < 12) return {type: 'respond', answer: 'raise'};
		return {type: 'respond', answer: rating >= needed || random() < 0.1 ? 'accept' : 'run'};
	}
	const wonFirst = hand.results[0] === teamOf(seat);
	if (canRaise(game, seat) && cards.length > 0) {
		const rating = handRating(cards, hand.manilha) + (wonFirst ? 0.25 : 0);
		if (rating >= 0.85 || random() < 0.04) return {type: 'raise'};
	}
	return {type: 'play', index: chooseCard(game, seat), hidden: false};
}
