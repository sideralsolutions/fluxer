// SPDX-License-Identifier: AGPL-3.0-or-later

export type GolfMode = 'classic' | 'tournament' | 'race';
export type GolfPhase = 'lobby' | 'countdown' | 'hole' | 'holeEnd' | 'results';

export interface GolfPlayer {
	name: string;
	userId: string | null;
	bot: boolean;
	online: boolean;
	total: number;
	points: number;
	out: boolean;
	strokes: number;
	done: boolean;
}

export interface GolfHoleResult {
	ranking: Array<{name: string; strokes: number; finished: boolean}>;
	eliminated: Array<string>;
}

export interface GolfFinalResult {
	mode: GolfMode;
	ranking: Array<{name: string; total: number; points: number}>;
}

export interface GolfView {
	phase: GolfPhase;
	mode: GolfMode;
	holeCount: number;
	holeIndex: number;
	you: number | null;
	timer: number;
	deadline: number | null;
	courseName: string | null;
	holeResult: GolfHoleResult | null;
	lastResult: GolfFinalResult | null;
	players: Array<GolfPlayer>;
}

export type GolfPhaseSound = 'go' | 'holeEnd' | 'eliminated' | 'won' | 'lost';

// O que soa quando a partida muda de fase. As batidas da bola vêm prontas do servidor, em cada quadro.
export function golfPhaseSounds(previous: GolfView | null, next: GolfView): Array<GolfPhaseSound> {
	if (!previous || previous.phase === next.phase) return [];
	const {phase, you, players, lastResult} = next;
	const yourName = you === null ? null : players[you].name;
	if (phase === 'hole') return ['go'];
	if (phase === 'results') return [lastResult?.ranking[0].name === yourName || you === null ? 'won' : 'lost'];
	if (phase === 'holeEnd') {
		const justOut = you !== null && players[you].out && !previous.players[you]?.out;
		return [justOut ? 'eliminated' : 'holeEnd'];
	}
	return [];
}

export const GOLF_COLORS = [0xffffff, 0xff5a36, 0x3ddc97, 0xffc533, 0x5cc8e8, 0xc77dff, 0xff7eb6, 0x9be564];
