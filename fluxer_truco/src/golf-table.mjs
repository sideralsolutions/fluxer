// SPDX-License-Identifier: AGPL-3.0-or-later

import {COURSES} from './golf-courses.mjs';
import {botShot, GolfWorld, STEP} from './golf-world.mjs';

const MAX_PLAYERS = 8;
const STROKE_LIMIT = 20;
const RACE_POINTS = [5, 3, 2, 1];
const BOT_NAMES = ['Bot Tonho', 'Bot Zefa', 'Bot Dito', 'Bot Nena', 'Bot Juca', 'Bot Lia', 'Bot Biu'];
const MODES = new Set(['classic', 'tournament', 'race']);
const HOLE_COUNTS = new Set([3, 6, 9]);
const FRAME_SECONDS = 0.05;
const IDLE_FRAME_SECONDS = 1;
export const DEFAULT_TIMING = {countdown: 3, holeLimit: 300, raceLimit: 30, holeEnd: 7, results: 12, botThink: [0.9, 2.1], awayThink: 6};

const round = (value) => Math.round(value * 1000) / 1000;

// Uma partida por sala de voz. O tempo só anda em tick(), que o servidor chama em intervalos curtos.
export class GolfTable {
	constructor({onChange, onMessage, timing = DEFAULT_TIMING, random = Math.random}) {
		Object.assign(this, {onChange, onMessage, timing, random});
		this.phase = 'lobby';
		this.mode = 'classic';
		this.holeCount = 3;
		this.players = [];
		this.connected = new Set();
		this.lastResult = null;
		this.world = null;
		this.pending = 0;
		this.frameTimer = 0;
		this.idleTimer = 0;
	}

	indexOf(userId) {
		const index = this.players.findIndex((player) => player.userId === userId);
		return index === -1 ? null : index;
	}

	setConnected(userId, connected) {
		if (connected) this.connected.add(userId);
		else this.connected.delete(userId);
		this.onChange();
	}

	join(user) {
		if (this.phase !== 'lobby') return 'game-running';
		if (this.indexOf(user.userId) !== null) return null;
		if (this.players.length >= MAX_PLAYERS) return 'table-full';
		this.players.push(this.newPlayer(user.userId, user.name, false));
		this.onChange();
		return null;
	}

	newPlayer(userId, name, bot) {
		return {userId, name, bot, total: 0, points: 0, out: false, place: null};
	}

	leave(userId) {
		const index = this.indexOf(userId);
		if (index === null) return null;
		if (this.phase !== 'lobby') return 'game-running';
		this.players.splice(index, 1);
		this.onChange();
		return null;
	}

	addBot(userId) {
		if (this.phase !== 'lobby') return 'game-running';
		if (this.indexOf(userId) === null) return 'not-joined';
		if (this.players.length >= MAX_PLAYERS) return 'table-full';
		const name = BOT_NAMES.find((candidate) => !this.players.some((player) => player.name === candidate));
		this.players.push(this.newPlayer(null, name, true));
		this.onChange();
		return null;
	}

	removeBot(userId) {
		if (this.phase !== 'lobby') return 'game-running';
		if (this.indexOf(userId) === null) return 'not-joined';
		const index = this.players.findLastIndex((player) => player.bot);
		if (index !== -1) this.players.splice(index, 1);
		this.onChange();
		return null;
	}

	configure(userId, {mode, holes}) {
		if (this.phase !== 'lobby') return 'game-running';
		if (this.indexOf(userId) === null) return 'not-joined';
		if (mode !== undefined && !MODES.has(mode)) return 'invalid-mode';
		if (holes !== undefined && !HOLE_COUNTS.has(holes)) return 'invalid-holes';
		this.mode = mode ?? this.mode;
		this.holeCount = holes ?? this.holeCount;
		this.onChange();
		return null;
	}

	start(userId) {
		if (this.phase !== 'lobby') return 'game-running';
		if (this.indexOf(userId) === null) return 'not-joined';
		if (this.mode === 'tournament' && this.players.length < 2) return 'needs-opponent';
		for (const player of this.players) Object.assign(player, {total: 0, points: 0, out: false, place: null});
		this.playlist = [...COURSES.keys()].sort(() => this.random() - 0.5);
		this.holeIndex = 0;
		this.lastResult = null;
		this.loadHole();
		return null;
	}

	stop(userId) {
		if (this.phase === 'lobby') return 'no-game';
		if (this.indexOf(userId) === null) return 'not-joined';
		this.backToLobby();
		return null;
	}

	backToLobby() {
		this.phase = 'lobby';
		this.world = null;
		this.onChange();
	}

	loadHole() {
		const course = COURSES[this.playlist[this.holeIndex % this.playlist.length]];
		this.world = new GolfWorld(course, this.players.length, {penalties: this.mode !== 'race'});
		this.players.forEach((player, index) => {
			const ball = this.world.balls[index];
			ball.out = player.out;
			player.brain = {wp: 0, think: this.timing.countdown + this.thinkTime()};
		});
		this.phase = 'countdown';
		this.timer = this.timing.countdown;
		this.deadline = this.timing.countdown + this.timing.holeLimit;
		this.holeResult = null;
		this.pending = 0;
		this.onMessage({t: 'course', course});
		this.onChange();
	}

	thinkTime() {
		const [low, high] = this.timing.botThink;
		return low + this.random() * (high - low);
	}

	shoot(userId, shot) {
		if (this.phase !== 'hole') return 'not-playing';
		const index = this.indexOf(userId);
		if (index === null) return 'not-joined';
		const ball = this.world.balls[index];
		if (ball.out || ball.done || !ball.rest) return 'not-ready';
		const {x, z, power} = shot ?? {};
		if (![x, z, power].every(Number.isFinite) || power <= 0) return 'invalid-shot';
		const length = Math.hypot(x, z);
		if (length === 0) return 'invalid-shot';
		this.world.shoot(ball, x / length, z / length, power);
		this.onChange();
		this.sendFrame();
		return null;
	}

	isAway(player) {
		return !player.bot && !this.connected.has(player.userId);
	}

	playBots(dt) {
		const {world} = this;
		this.players.forEach((player, index) => {
			const ball = world.balls[index];
			if (ball.out || ball.done || !ball.rest || !(player.bot || this.isAway(player))) return;
			player.brain.think -= dt;
			if (player.brain.think > 0) return;
			const shot = botShot(world, player.brain, ball, this.random);
			world.shoot(ball, shot.x, shot.z, shot.power);
			player.brain.think = player.bot ? this.thinkTime() : this.timing.awayThink;
			this.onChange();
		});
	}

	giveUpOverLimit() {
		if (this.mode === 'race') return;
		for (const ball of this.world.balls) {
			if (ball.out || ball.done || !ball.rest || ball.strokes < STROKE_LIMIT) continue;
			ball.done = true;
			ball.gaveUp = true;
			this.onChange();
		}
	}

	finishRaceTimer() {
		if (this.mode !== 'race') return;
		const first = Math.min(...this.world.balls.map((ball) => ball.finishedAt ?? Infinity));
		if (first + this.timing.raceLimit >= this.deadline) return;
		this.deadline = first + this.timing.raceLimit;
		this.onChange();
	}

	tick(dt) {
		if (this.phase === 'lobby') return;
		if (this.connected.size === 0) {
			this.backToLobby();
			return;
		}
		if (this.phase === 'countdown' || this.phase === 'hole') this.advanceWorld(dt);
		if (this.phase === 'countdown') {
			this.timer -= dt;
			if (this.timer <= 0) {
				this.phase = 'hole';
				this.onChange();
			}
			return;
		}
		if (this.phase === 'hole') {
			this.playBots(dt);
			this.giveUpOverLimit();
			this.finishRaceTimer();
			const active = this.world.balls.filter((ball) => !ball.out);
			if (active.every((ball) => ball.done) || this.world.time >= this.deadline) this.endHole();
			return;
		}
		this.timer -= dt;
		if (this.timer > 0) return;
		if (this.phase === 'holeEnd') this.loadHole();
		else if (this.phase === 'results') this.backToLobby();
	}

	advanceWorld(dt) {
		const {world} = this;
		const finished = world.balls.filter((ball) => ball.done).length;
		const strokes = world.balls.reduce((sum, ball) => sum + ball.strokes, 0);
		this.pending += dt;
		while (this.pending >= STEP) {
			world.step(STEP);
			this.pending -= STEP;
		}
		this.frameTimer += dt;
		this.idleTimer += dt;
		const due = world.moving ? this.frameTimer >= FRAME_SECONDS : this.idleTimer >= IDLE_FRAME_SECONDS;
		if (due || world.events.length > 0) this.sendFrame();
		if (world.balls.filter((ball) => ball.done).length !== finished || world.balls.reduce((sum, ball) => sum + ball.strokes, 0) !== strokes) this.onChange();
	}

	sendFrame() {
		const {world} = this;
		this.frameTimer = 0;
		this.idleTimer = 0;
		const balls = world.balls.map((ball) => [round(ball.x), round(ball.y), round(ball.z), ball.done ? 2 : ball.rest ? 1 : 0]);
		this.onMessage({t: 'frame', time: round(world.time), balls, events: world.events});
		world.events = [];
	}

	endHole() {
		const {world} = this;
		const active = this.players.map((player, index) => ({player, ball: world.balls[index]})).filter(({ball}) => !ball.out);
		for (const {ball} of active) {
			if (ball.finishedAt === null && this.mode !== 'race') ball.strokes = STROKE_LIMIT + 1;
		}
		const arrival = (ball) => ball.finishedAt ?? Infinity;
		const ranked = [...active].sort((a, b) => (this.mode === 'race' ? arrival(a.ball) - arrival(b.ball) : a.ball.strokes - b.ball.strokes || arrival(a.ball) - arrival(b.ball)));
		ranked.forEach(({player, ball}, position) => {
			player.total += ball.strokes;
			if (this.mode === 'race' && ball.finishedAt !== null) player.points += RACE_POINTS[position] ?? 0;
		});
		const eliminated = this.mode === 'tournament' ? ranked.slice(ranked.length > 4 ? -2 : -1) : [];
		eliminated.forEach(({player}, order) => {
			player.out = true;
			player.place = ranked.length - eliminated.length + order + 1;
		});
		this.holeResult = {
			ranking: ranked.map(({player, ball}) => ({name: player.name, strokes: ball.strokes, finished: ball.finishedAt !== null})),
			eliminated: eliminated.map(({player}) => player.name),
		};
		this.holeIndex += 1;
		this.phase = this.isOver() ? 'results' : 'holeEnd';
		if (this.phase === 'results') this.closeGame();
		this.timer = this.phase === 'results' ? this.timing.results : this.timing.holeEnd;
		this.sendFrame();
		this.onChange();
	}

	isOver() {
		if (this.mode === 'tournament') return this.players.filter((player) => !player.out).length <= 1;
		return this.holeIndex >= this.holeCount;
	}

	closeGame() {
		const byMode = {
			classic: (a, b) => a.total - b.total,
			race: (a, b) => b.points - a.points || a.total - b.total,
			tournament: (a, b) => (a.place ?? 1) - (b.place ?? 1),
		};
		const ranking = [...this.players].sort(byMode[this.mode]);
		this.lastResult = {mode: this.mode, ranking: ranking.map(({name, total, points}) => ({name, total, points}))};
	}

	viewFor(userId) {
		const {world} = this;
		return {
			phase: this.phase,
			mode: this.mode,
			holeCount: this.holeCount,
			holeIndex: this.holeIndex ?? 0,
			you: this.indexOf(userId),
			timer: round(this.timer ?? 0),
			deadline: this.phase === 'hole' ? this.deadline : null,
			courseName: world?.course.name ?? null,
			holeResult: this.holeResult ?? null,
			lastResult: this.lastResult,
			players: this.players.map((player, index) => {
				const ball = world?.balls[index];
				return {
					name: player.name,
					userId: player.userId,
					bot: player.bot,
					online: player.bot || this.connected.has(player.userId),
					total: player.total,
					points: player.points,
					out: player.out,
					strokes: ball?.strokes ?? 0,
					done: ball?.done ?? false,
				};
			}),
		};
	}

	// Quem entra no meio recebe a pista e a última posição de todos.
	snapshotFor() {
		if (!this.world) return [];
		const {world} = this;
		const balls = world.balls.map((ball) => [round(ball.x), round(ball.y), round(ball.z), ball.done ? 2 : ball.rest ? 1 : 0]);
		return [{t: 'course', course: world.course}, {t: 'frame', time: round(world.time), balls, events: []}];
	}

	get idle() {
		return this.connected.size === 0;
	}

	finish() {
		this.world = null;
		this.phase = 'lobby';
	}
}
