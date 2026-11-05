// SPDX-License-Identifier: AGPL-3.0-or-later

export interface Card {
	rank: string;
	suit: string;
}

export interface TablePlay {
	seat: number;
	hidden: boolean;
	card: Card | null;
}

export interface GameView {
	players: number;
	handNumber: number;
	score: [number, number];
	winner: number | null;
	vira: Card;
	manilha: string;
	turn: number;
	value: number;
	phase: 'play' | 'raise' | 'eleven' | 'ended';
	raise: {by: number; seat: number; proposed: number; awaiting: number} | null;
	elevenTeam: number | null;
	blind: boolean;
	ended: {team: number; points: number; reason: string} | null;
	canRaise: boolean;
	canHide: boolean;
	trickResults: Array<number | 'tie'>;
	lastTrick: Array<TablePlay>;
	lastTrickWinner: number | null;
	table: Array<TablePlay>;
	hand: Array<Card | null>;
	cardCounts: Array<number>;
	partners: Array<{seat: number; cards: Array<Card>}>;
}

export interface SeatView {
	name: string;
	userId: string | null;
	bot: boolean;
	online: boolean;
}

export interface TableView {
	players: number;
	seats: Array<SeatView | null>;
	teamNames: [string, string];
	turnMs: number;
	you: number | null;
	lastResult: {score: [number, number]; winner: number} | null;
	game: GameView | null;
	actingSeat: number | null;
}

export type TrucoSound =
	| 'deal'
	| 'card'
	| 'trickWon'
	| 'trickLost'
	| 'trickTied'
	| 'truco'
	| 'accept'
	| 'run'
	| 'points'
	| 'yourTurn'
	| 'gameWon'
	| 'gameLost';

const isYourMove = ({game, you, actingSeat}: TableView) => game !== null && you !== null && actingSeat === you;

// O servidor só manda o estado, então o que aconteceu sai da diferença entre dois estados seguidos.
export function trucoSoundsBetween(previous: TableView | null, next: TableView): Array<TrucoSound> {
	const {game} = next;
	if (!previous || !game) return [];
	const before = previous.game;
	const sounds: Array<TrucoSound> = [];
	const yourTurn = isYourMove(next) && (!isYourMove(previous) || before?.handNumber !== game.handNumber);
	if (before?.handNumber !== game.handNumber) {
		sounds.push('deal');
		if (yourTurn) sounds.push('yourTurn');
		return sounds;
	}
	const yourTeam = next.you === null ? null : next.you % 2;
	const isYours = (team: number) => yourTeam === null || team === yourTeam;
	const trickResult = game.trickResults.length > before.trickResults.length ? game.trickResults.at(-1) : undefined;
	if (trickResult !== undefined || game.table.length > before.table.length) sounds.push('card');
	if (trickResult === 'tie') sounds.push('trickTied');
	else if (trickResult !== undefined) sounds.push(isYours(trickResult) ? 'trickWon' : 'trickLost');
	if (game.raise && game.raise.proposed !== before.raise?.proposed) sounds.push('truco');
	if (before.raise && !game.raise) sounds.push(game.ended ? 'run' : 'accept');
	if (game.ended && !before.ended) {
		if (game.winner === null) sounds.push('points');
		else sounds.push(isYours(game.winner) ? 'gameWon' : 'gameLost');
	}
	if (yourTurn) sounds.push('yourTurn');
	return sounds;
}
