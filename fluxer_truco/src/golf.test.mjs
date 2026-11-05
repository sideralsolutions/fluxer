// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {after, before, describe, it} from 'node:test';
import WebSocket from 'ws';
import {COURSES} from './golf-courses.mjs';
import {DEFAULT_TIMING, GolfTable} from './golf-table.mjs';
import {botShot, GolfWorld, STEP} from './golf-world.mjs';
import {startServer} from './server.mjs';

const fast = {...DEFAULT_TIMING, countdown: 0.1, holeEnd: 0.1, results: 0.1, botThink: [0.1, 0.2]};

function seededRandom(seed = 7) {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function table(options = {}) {
	const messages = [];
	const golf = new GolfTable({onChange() {}, onMessage: (message) => messages.push(message), timing: fast, random: seededRandom(), ...options});
	golf.messages = messages;
	golf.setConnected('1', true);
	assert.equal(golf.join({userId: '1', name: 'Ana'}), null);
	return golf;
}

// Roda até a fase pedida, com o humano sumido para o bot jogar por ele quando necessário.
function runUntil(golf, done, seconds = 3000) {
	for (let t = 0; t < seconds && !done(); t += 1 / 30) golf.tick(1 / 30);
	assert.ok(done(), `parou em ${golf.phase}`);
}

describe('pistas', () => {
	it('toda pista tem começo, buraco e rota', () => {
		assert.equal(COURSES.length, 9);
		for (const course of COURSES) {
			assert.ok(course.hole, course.name);
			assert.ok(course.way.length > 5, course.name);
		}
	});

	it('toda pista dá para terminar', () => {
		for (const course of COURSES) {
			const finished = Array.from({length: 20}, (_, n) => n + 1).some((seed) => {
				const random = seededRandom(seed);
				const world = new GolfWorld(course, 1);
				const [ball] = world.balls;
				const brain = {wp: 0};
				for (let t = 0; t < 400 && !ball.done; t += STEP) {
					if (ball.rest) {
						const shot = botShot(world, brain, ball, random);
						world.shoot(ball, shot.x, shot.z, shot.power);
					}
					world.step(STEP);
				}
				return ball.done;
			});
			assert.ok(finished, course.name);
		}
	});
});

describe('física', () => {
	const course = COURSES[0];

	it('a tacada conta, faz barulho e a bola para sozinha', () => {
		const world = new GolfWorld(course, 1);
		const [ball] = world.balls;
		world.shoot(ball, 0, 1, 0.2);
		assert.equal(ball.strokes, 1);
		assert.deepEqual(world.events[0], ['hit', 0, 0.2]);
		for (let i = 0; i < 2000 && !ball.rest; i++) world.step(STEP);
		assert.equal(ball.rest, true);
		assert.ok(ball.z > course.start[1]);
	});

	it('bolas batem e a parada volta a andar', () => {
		const world = new GolfWorld(course, 2);
		const [a, b] = world.balls;
		b.z = a.z + 1;
		b.x = a.x;
		world.shoot(a, 0, 1, 0.3);
		for (let i = 0; i < 200 && b.rest; i++) world.step(STEP);
		assert.equal(b.rest, false);
	});

	it('cair da pista volta ao último lugar e custa uma tacada', () => {
		const world = new GolfWorld(course, 1);
		const [ball] = world.balls;
		ball.rest = false;
		ball.x = 100;
		for (let i = 0; i < 1000 && !ball.rest; i++) world.step(STEP);
		assert.equal(ball.strokes, 1);
		assert.deepEqual([ball.x, ball.y, ball.z], ball.last);
		assert.ok(world.events.some(([kind]) => kind === 'fall'));
	});

	it('na corrida cair não custa tacada', () => {
		const world = new GolfWorld(course, 1, {penalties: false});
		const [ball] = world.balls;
		ball.rest = false;
		ball.x = 100;
		for (let i = 0; i < 1000 && !ball.rest; i++) world.step(STEP);
		assert.equal(ball.strokes, 0);
	});
});

describe('partida', () => {
	it('só joga quem entrou e nem antes da contagem', () => {
		const golf = table();
		assert.equal(golf.shoot('1', {x: 0, z: 1, power: 0.5}), 'not-playing');
		golf.start('1');
		assert.equal(golf.phase, 'countdown');
		assert.equal(golf.shoot('1', {x: 0, z: 1, power: 0.5}), 'not-playing');
		runUntil(golf, () => golf.phase === 'hole');
		assert.equal(golf.shoot('2', {x: 0, z: 1, power: 0.5}), 'not-joined');
		assert.equal(golf.shoot('1', {x: Number.NaN, z: 1, power: 0.5}), 'invalid-shot');
		assert.equal(golf.shoot('1', {x: 0, z: 1, power: 0.5}), null);
		assert.equal(golf.shoot('1', {x: 0, z: 1, power: 0.5}), 'not-ready');
	});

	it('não deixa entrar nem mudar o modo no meio da partida', () => {
		const golf = table();
		golf.start('1');
		assert.equal(golf.join({userId: '2', name: 'Bia'}), 'game-running');
		assert.equal(golf.configure('1', {mode: 'race'}), 'game-running');
		assert.equal(golf.addBot('1'), 'game-running');
	});

	it('a força da tacada nunca passa do limite', () => {
		const golf = table();
		golf.start('1');
		runUntil(golf, () => golf.phase === 'hole');
		golf.shoot('1', {x: 0, z: 1, power: 50});
		assert.ok(Math.hypot(golf.world.balls[0].vx, golf.world.balls[0].vz) <= 17);
	});

	it('clássico soma as tacadas de todas as pistas e menor vence', () => {
		const golf = table();
		golf.addBot('1');
		golf.configure('1', {holes: 3});
		golf.start('1');
		golf.connected.add('1');
		golf.players[0].bot = true;
		runUntil(golf, () => golf.lastResult !== null);
		const {ranking} = golf.lastResult;
		assert.equal(ranking.length, 2);
		assert.ok(ranking[0].total <= ranking[1].total);
		assert.equal(golf.holeIndex, 3);
	});

	it('torneio elimina o pior de cada pista até sobrar um', () => {
		const golf = table();
		for (let i = 0; i < 3; i++) golf.addBot('1');
		golf.configure('1', {mode: 'tournament'});
		golf.start('1');
		golf.players[0].bot = true;
		const eliminated = [];
		let seen = null;
		runUntil(golf, () => {
			if (golf.holeResult && golf.holeResult !== seen) {
				seen = golf.holeResult;
				eliminated.push(...seen.eliminated);
			}
			return golf.lastResult !== null;
		});
		assert.equal(eliminated.length, 3);
		assert.equal(new Set(eliminated).size, 3);
		assert.equal(golf.lastResult.ranking[0].name, golf.players.find((player) => !player.out).name);
		assert.equal(golf.lastResult.ranking.at(-1).name, eliminated[0]);
	});

	it('torneio tira dois por pista quando a mesa é grande', () => {
		const golf = table();
		for (let i = 0; i < 5; i++) golf.addBot('1');
		golf.configure('1', {mode: 'tournament'});
		golf.start('1');
		golf.players[0].bot = true;
		runUntil(golf, () => golf.holeResult !== null);
		assert.equal(golf.holeResult.eliminated.length, 2);
	});

	it('torneio precisa de adversário', () => {
		const golf = table();
		golf.configure('1', {mode: 'tournament'});
		assert.equal(golf.start('1'), 'needs-opponent');
	});

	it('corrida dá pontos por ordem de chegada e encerra depois do primeiro', () => {
		const golf = table();
		golf.addBot('1');
		golf.configure('1', {mode: 'race', holes: 3});
		golf.start('1');
		runUntil(golf, () => golf.phase === 'hole');
		golf.world.sink(golf.world.balls[0]);
		const finishedAt = golf.world.time;
		golf.tick(1 / 30);
		assert.ok(golf.deadline <= finishedAt + fast.raceLimit);
		runUntil(golf, () => golf.holeResult !== null);
		assert.ok(golf.world.time <= finishedAt + fast.raceLimit + 0.1);
		assert.equal(golf.players[0].points, 5);
	});

	it('quem caiu da chamada é jogado pelo bot até voltar', () => {
		const golf = table();
		golf.setConnected('2', true);
		golf.join({userId: '2', name: 'Bia'});
		golf.start('1');
		golf.setConnected('2', false);
		runUntil(golf, () => golf.world.balls[1].strokes > 0, 30);
	});

	it('sem ninguém conectado a partida acaba', () => {
		const golf = table();
		golf.start('1');
		golf.setConnected('1', false);
		golf.tick(1 / 30);
		assert.equal(golf.phase, 'lobby');
	});

	it('avisa o resultado sem contar tacada de quem estourou o limite como buraco', () => {
		const golf = table();
		golf.start('1');
		runUntil(golf, () => golf.phase === 'hole');
		golf.world.balls[0].strokes = 20;
		golf.tick(1 / 30);
		assert.equal(golf.phase === 'holeEnd' || golf.phase === 'results', true);
		assert.equal(golf.holeResult.ranking[0].strokes, 21);
		assert.equal(golf.holeResult.ranking[0].finished, false);
	});
});

describe('conexão', () => {
	const apiKey = 'key';
	const apiSecret = 'secret';
	const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
	function token(sub) {
		const body = `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub, iss: apiKey, exp: Date.now() / 1000 + 600, video: {room: 'sala'}})}`;
		return `${body}.${createHmac('sha256', apiSecret).update(body).digest('base64url')}`;
	}
	let server;
	let port;

	before(async () => {
		({server} = await startServer({port: 0, apiKey, apiSecret, golfTiming: fast}));
		port = server.address().port;
	});
	after(() => server.close());

	function connect(sub, name) {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/golf`);
		const seen = [];
		const waiters = [];
		socket.on('message', (raw) => {
			const message = JSON.parse(raw);
			seen.push(message);
			for (const waiter of waiters.splice(0)) waiter();
		});
		socket.next = async (test) => {
			for (;;) {
				const found = seen.find(test);
				if (found) return found;
				await new Promise((resolve) => waiters.push(resolve));
			}
		};
		return new Promise((resolve) => socket.on('open', () => {
			socket.send(JSON.stringify({t: 'hello', token: token(sub), name}));
			resolve(socket);
		}));
	}

	it('recusa token inválido', async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/golf`);
		await new Promise((resolve) => socket.on('open', resolve));
		socket.send(JSON.stringify({t: 'hello', token: 'x', name: 'Ana'}));
		const code = await new Promise((resolve) => socket.on('close', resolve));
		assert.equal(code, 4001);
	});

	it('dois jogadores da mesma sala veem a mesma partida, e quem chega depois recebe a pista', async () => {
		const ana = await connect('user_1_a', 'Ana');
		const bia = await connect('user_2_b', 'Bia');
		ana.send(JSON.stringify({t: 'join'}));
		bia.send(JSON.stringify({t: 'join'}));
		await bia.next((m) => m.t === 'state' && m.state.players.length === 2);
		ana.send(JSON.stringify({t: 'start'}));
		await bia.next((m) => m.t === 'course');
		await ana.next((m) => m.t === 'state' && m.state.phase === 'hole');
		ana.send(JSON.stringify({t: 'shot', x: 0, z: 1, power: 0.3}));
		const frame = await bia.next((m) => m.t === 'frame' && m.events.some(([kind]) => kind === 'hit'));
		assert.equal(frame.balls.length, 2);
		const caio = await connect('user_3_c', 'Caio');
		await caio.next((m) => m.t === 'course');
		const state = await caio.next((m) => m.t === 'state');
		assert.equal(state.state.you, null);
		for (const socket of [ana, bia, caio]) socket.close();
	});

	it('o truco continua na rota antiga', async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		await new Promise((resolve) => socket.on('open', resolve));
		socket.close();
	});
});
