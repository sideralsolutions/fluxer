// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {after, before, describe, it} from 'node:test';
import WebSocket from 'ws';
import {verifyVoiceToken} from './auth.mjs';
import {startServer} from './server.mjs';

const apiKey = 'key';
const apiSecret = 'secret';
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token({sub = 'user_1_abc', room = 'sala', iss = apiKey, exp = Date.now() / 1000 + 600, secret = apiSecret} = {}) {
	const body = `${b64({alg: 'HS256', typ: 'JWT'})}.${b64({sub, iss, exp, video: {room}})}`;
	return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

describe('token de voz', () => {
	const verify = (value) => verifyVoiceToken(value, {apiKey, apiSecret});
	it('aceita token válido e tira o usuário e a sala', () => {
		assert.deepEqual(verify(token()), {userId: '1', room: 'sala'});
	});
	it('aceita vencido há pouco e recusa vencido há mais de um dia', () => {
		assert.ok(verify(token({exp: Date.now() / 1000 - 3600})));
		assert.equal(verify(token({exp: Date.now() / 1000 - 90000})), null);
	});
	it('recusa assinatura errada, outro emissor e lixo', () => {
		assert.equal(verify(token({secret: 'outro'})), null);
		assert.equal(verify(token({iss: 'outro'})), null);
		assert.equal(verify('a.b.c'), null);
		assert.equal(verify(undefined), null);
	});
	it('recusa alg none', () => {
		const forged = `${b64({alg: 'none'})}.${b64({sub: 'user_1', iss: apiKey, exp: 9e9, video: {room: 'x'}})}.`;
		assert.equal(verify(forged), null);
	});
});

class Client {
	constructor(port, user, room = 'sala') {
		this.socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		this.states = [];
		this.errors = [];
		this.closed = new Promise((resolve) => this.socket.on('close', resolve));
		this.socket.on('message', (raw) => {
			const message = JSON.parse(raw);
			if (message.t === 'state') this.states.push(message.state);
			else this.errors.push(message.code);
		});
		this.open = new Promise((resolve) => this.socket.on('open', resolve)).then(() =>
			this.send({t: 'hello', token: token({sub: `user_${user}_x`, room}), name: `P${user}`}),
		);
	}
	send(message) {
		this.socket.send(JSON.stringify(message));
	}
	get state() {
		return this.states.at(-1);
	}
	async until(check) {
		for (let i = 0; i < 400; i++) {
			if (this.state && check(this.state)) return this.state;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		throw new Error(`timeout: ${JSON.stringify(this.state)}`);
	}
}

describe('mesa pela rede', () => {
	let running;
	const port = 18432;
	before(async () => {
		running = await startServer({port, apiKey, apiSecret, timing: {humanTurnMs: 40, botTurnMs: 1, handPauseMs: 1}});
	});
	after(() => {
		for (const socket of running.sockets.clients) socket.terminate();
		running.server.close();
		for (const entry of running.tables.values()) entry.table.finish();
	});

	it('fecha a conexão com token inválido', async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
		await new Promise((resolve) => socket.on('open', resolve));
		socket.send(JSON.stringify({t: 'hello', token: token({secret: 'x'})}));
		const code = await new Promise((resolve) => socket.on('close', resolve));
		assert.equal(code, 4001);
	});

	it('bots completam a mesa 3x3, a partida vai até o fim e volta para o lobby', async () => {
		const client = new Client(port, 10, 'partida');
		await client.open;
		await client.until((state) => state.players === 4);
		client.send({t: 'mode', players: 6});
		await client.until((state) => state.players === 6);
		client.send({t: 'sit', seat: 0});
		await client.until((state) => state.you === 0);
		client.send({t: 'start'});
		await client.until((state) => state.game);
		assert.ok(client.state.seats.every(Boolean));
		assert.equal(client.state.seats.filter((seat) => seat.bot).length, 5);
		assert.equal(client.state.game.hand.length, 3);
		const end = await client.until((state) => state.lastResult);
		assert.equal(end.game, null);
		assert.ok(end.lastResult.score[end.lastResult.winner] >= 12);
		client.socket.close();
	});

	it('nenhuma mensagem de um jogador traz a mão do outro, e cada sala é separada', async () => {
		const a = new Client(port, 20, 'privada');
		const b = new Client(port, 21, 'privada');
		const c = new Client(port, 22, 'outra');
		await Promise.all([a.open, b.open, c.open]);
		a.send({t: 'sit', seat: 0});
		b.send({t: 'sit', seat: 1});
		await a.until((state) => state.seats[1]);
		assert.ok(c.state.seats.every((seat) => seat === null));
		a.send({t: 'start'});
		const stateA = await a.until((state) => state.game);
		const stateB = await b.until((state) => state.game);
		assert.notDeepEqual(stateA.game.hand, stateB.game.hand);
		assert.equal(stateA.game.cardCounts[1], 3);
		assert.equal(JSON.stringify(stateA).includes(JSON.stringify(stateB.game.hand[0])), false);
		a.send({t: 'stop'});
		await a.until((state) => !state.game);
		for (const client of [a, b, c]) client.socket.close();
	});

	it('só quem está no time muda o nome dele, e o nome é limitado', async () => {
		const a = new Client(port, 40, 'nomes');
		await a.open;
		a.send({t: 'sit', seat: 0});
		await a.until((state) => state.you === 0);
		a.send({t: 'teamName', team: 1, name: 'Invasores'});
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.deepEqual(a.errors, ['not-your-team']);
		a.send({t: 'teamName', team: 0, name: `  ${'x'.repeat(40)}  `});
		const state = await a.until((value) => value.teamNames[0]);
		assert.equal(state.teamNames[0].length, 20);
		a.socket.close();
	});

	it('quem cai é jogado pelo bot e reassume ao voltar', async () => {
		const a = new Client(port, 30, 'queda');
		await a.open;
		a.send({t: 'sit', seat: 0});
		await a.until((state) => state.you === 0);
		a.send({t: 'start'});
		await a.until((state) => state.game);
		a.socket.close();
		await a.closed;
		await new Promise((resolve) => setTimeout(resolve, 30));
		const back = new Client(port, 30, 'queda');
		await back.open;
		const state = await back.until((value) => value.you === 0);
		assert.ok(state.game || state.lastResult);
		back.socket.close();
	});
});
