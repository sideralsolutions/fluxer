// SPDX-License-Identifier: AGPL-3.0-or-later

import {botAction} from './bot.mjs';
import {createGame, decideEleven, play, raise, respond, startHand, teamOf, viewFor} from './engine.mjs';

const BOT_NAMES = ['Bot Tonho', 'Bot Zefa', 'Bot Dito', 'Bot Nena', 'Bot Juca', 'Bot Lia'];
const TEAM_NAME_MAX_LENGTH = 20;
export const DEFAULT_TIMING = {humanTurnMs: 30_000, botTurnMs: 1_100, trickPauseMs: 2_000, handPauseMs: 4_000};

// Uma mesa por sala de voz. Quem está offline ou estoura o tempo é jogado pelo bot até voltar.
export class Table {
	constructor({onChange, timing = DEFAULT_TIMING, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout}) {
		Object.assign(this, {onChange, timing, random, setTimer, clearTimer});
		this.players = 4;
		this.seats = Array(4).fill(null);
		this.connected = new Set();
		this.teamNames = ['', ''];
		this.game = null;
		this.timer = null;
	}

	seatOf(userId) {
		const seat = this.seats.findIndex((entry) => entry?.userId === userId);
		return seat === -1 ? null : seat;
	}

	setConnected(userId, connected) {
		if (connected) this.connected.add(userId);
		else this.connected.delete(userId);
		if (this.game) this.schedule();
		this.onChange();
	}

	setMode(players) {
		if (this.game) return 'game-running';
		if (players !== 4 && players !== 6) return 'invalid-mode';
		if (this.seats.slice(players).some(Boolean)) return 'seats-taken';
		this.players = players;
		this.seats = Array.from({length: players}, (_, seat) => this.seats[seat] ?? null);
		this.onChange();
		return null;
	}

	setTeamName(userId, team, name) {
		if (team !== 0 && team !== 1 || typeof name !== 'string') return 'invalid-team';
		const seat = this.seatOf(userId);
		if (seat === null || teamOf(seat) !== team) return 'not-your-team';
		this.teamNames[team] = name.trim().slice(0, TEAM_NAME_MAX_LENGTH);
		this.onChange();
		return null;
	}

	sit(user, seat) {
		if (!Number.isInteger(seat) || seat < 0 || seat >= this.players) return 'invalid-seat';
		const current = this.seats[seat];
		if (current && !current.bot) return 'seat-taken';
		const previous = this.seatOf(user.userId);
		if (this.game && previous !== null) return 'game-running';
		if (previous !== null) this.seats[previous] = null;
		this.seats[seat] = {userId: user.userId, name: user.name, bot: false};
		this.onChange();
		if (this.game) this.schedule();
		return null;
	}

	standUp(userId) {
		const seat = this.seatOf(userId);
		if (seat === null) return null;
		this.seats[seat] = this.game ? this.newBot(seat) : null;
		if (this.game) this.schedule();
		this.onChange();
		return null;
	}

	newBot(seat) {
		return {userId: null, name: BOT_NAMES[seat % BOT_NAMES.length], bot: true};
	}

	start(userId) {
		if (this.game) return 'game-running';
		if (this.seatOf(userId) === null) return 'not-seated';
		this.seats = this.seats.map((entry, seat) => entry ?? this.newBot(seat));
		this.game = createGame({players: this.players, random: this.random});
		this.schedule();
		this.onChange();
		return null;
	}

	stop(userId) {
		if (!this.game) return 'no-game';
		if (this.seatOf(userId) === null) return 'not-seated';
		this.finish();
		return null;
	}

	finish() {
		this.clearTimer(this.timer);
		this.timer = null;
		this.game = null;
		this.seats = this.seats.map((entry) => (entry?.bot ? null : entry));
		this.onChange();
	}

	act(userId, action) {
		if (!this.game) return 'no-game';
		const seat = this.seatOf(userId);
		if (seat === null) return 'not-seated';
		const error = this.apply(seat, action);
		if (error) return error;
		this.schedule();
		this.onChange();
		return null;
	}

	apply(seat, action) {
		switch (action?.type) {
			case 'play':
				return play(this.game, seat, action.index, action.hidden === true);
			case 'raise':
				return raise(this.game, seat);
			case 'respond':
				return respond(this.game, seat, action.answer);
			case 'eleven':
				return decideEleven(this.game, seat, action.answer);
			default:
				return 'invalid-action';
		}
	}

	// Quem precisa agir: a vez, ou o primeiro do time que responde, preferindo humano conectado.
	actingSeat() {
		const {hand, players} = this.game;
		if (hand.phase === 'play') return hand.turn;
		const team = hand.phase === 'raise' ? hand.raise.awaiting : hand.elevenTeam;
		const seats = Array.from({length: players}, (_, n) => (hand.turn + n) % players).filter((seat) => teamOf(seat) === team);
		return seats.find((seat) => this.isHumanOnline(seat)) ?? seats[0];
	}

	isHumanOnline(seat) {
		const entry = this.seats[seat];
		return Boolean(entry && !entry.bot && this.connected.has(entry.userId));
	}

	schedule() {
		this.clearTimer(this.timer);
		this.timer = null;
		const {game} = this;
		if (!game) return;
		if (game.hand.phase === 'ended') {
			this.timer = this.setTimer(() => this.advanceHand(), this.timing.handPauseMs);
			return;
		}
		const seat = this.actingSeat();
		const {hand} = game;
		const afterTrick = hand.table.length === 0 && hand.tricks.length > 0;
		const botDelay = Math.max(this.timing.botTurnMs, afterTrick ? (this.timing.trickPauseMs ?? 0) : 0);
		const delay = this.isHumanOnline(seat) ? this.timing.humanTurnMs : botDelay;
		this.timer = this.setTimer(() => this.autoAct(seat), delay);
	}

	advanceHand() {
		if (this.game.winner !== null) {
			this.lastResult = {score: this.game.score, winner: this.game.winner};
			this.finish();
			return;
		}
		startHand(this.game);
		this.schedule();
		this.onChange();
	}

	autoAct(seat) {
		const error = this.apply(seat, botAction(this.game, seat));
		if (error) console.error('bot action rejected', error);
		this.schedule();
		this.onChange();
	}

	viewFor(userId) {
		const seat = this.seatOf(userId);
		return {
			players: this.players,
			seats: this.seats.map(
				(entry) =>
					entry && {name: entry.name, userId: entry.userId, bot: entry.bot, online: entry.bot || this.connected.has(entry.userId)},
			),
			teamNames: this.teamNames,
			turnMs: this.timing.humanTurnMs,
			you: seat,
			lastResult: this.lastResult ?? null,
			game: this.game ? viewFor(this.game, seat) : null,
			actingSeat: this.game && this.game.hand.phase !== 'ended' ? this.actingSeat() : null,
		};
	}

	get idle() {
		return this.connected.size === 0;
	}
}
