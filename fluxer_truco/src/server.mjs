// SPDX-License-Identifier: AGPL-3.0-or-later

import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';
import {verifyVoiceToken} from './auth.mjs';
import {GolfTable} from './golf-table.mjs';
import {Table} from './table.mjs';

const NAME_MAX_LENGTH = 32;
const HELLO_TIMEOUT_MS = 10_000;
const IDLE_TABLE_TTL_MS = 30 * 60 * 1000;
const GOLF_TICK_MS = 1000 / 30;

function handleTruco(table, userId, user, message) {
	switch (message.t) {
		case 'mode':
			return table.setMode(message.players);
		case 'sit':
			return table.sit(user, message.seat);
		case 'teamName':
			return table.setTeamName(userId, message.team, message.name);
		case 'stand':
			return table.standUp(userId);
		case 'start':
			return table.start(userId);
		case 'stop':
			return table.stop(userId);
		case 'action':
			return table.act(userId, message.action);
		default:
			return 'invalid-message';
	}
}

function handleGolf(table, userId, user, message) {
	switch (message.t) {
		case 'join':
			return table.join(user);
		case 'leave':
			return table.leave(userId);
		case 'configure':
			return table.configure(userId, message);
		case 'addBot':
			return table.addBot(userId);
		case 'removeBot':
			return table.removeBot(userId);
		case 'start':
			return table.start(userId);
		case 'stop':
			return table.stop(userId);
		case 'shot':
			return table.shoot(userId, message);
		default:
			return 'invalid-message';
	}
}

// Mesas de um jogo, uma por sala de voz. A identidade vem do token de voz, que só o dono da conexão tem.
function createGameRoom({apiKey, apiSecret, createTable, handle}) {
	const tables = new Map();

	function broadcast(entry) {
		for (const socket of entry.sockets) {
			socket.send(JSON.stringify({t: 'state', state: entry.table.viewFor(socket.user.userId)}));
		}
	}

	function send(entry, message) {
		const payload = JSON.stringify(message);
		for (const socket of entry.sockets) socket.send(payload);
	}

	function openTable(room) {
		let entry = tables.get(room);
		if (!entry) {
			entry = {sockets: new Set(), cleanup: null, table: null};
			entry.table = createTable({onChange: () => broadcast(entry), onMessage: (message) => send(entry, message)});
			tables.set(room, entry);
		}
		clearTimeout(entry.cleanup);
		return entry;
	}

	function hello(socket, message) {
		const identity = verifyVoiceToken(message.token, {apiKey, apiSecret});
		if (!identity) {
			socket.close(4001, 'unauthorized');
			return null;
		}
		const name = typeof message.name === 'string' ? message.name.trim().slice(0, NAME_MAX_LENGTH) : '';
		socket.user = {userId: identity.userId, name: name || 'Jogador'};
		const entry = openTable(identity.room);
		entry.sockets.add(socket);
		for (const snapshot of entry.table.snapshotFor?.() ?? []) socket.send(JSON.stringify(snapshot));
		entry.table.setConnected(identity.userId, true);
		return {entry, room: identity.room};
	}

	function leave(entry, room, socket) {
		entry.sockets.delete(socket);
		const stillHere = [...entry.sockets].some((other) => other.user.userId === socket.user.userId);
		if (!stillHere) entry.table.setConnected(socket.user.userId, false);
		if (entry.table.idle) {
			entry.cleanup = setTimeout(() => {
				entry.table.finish();
				tables.delete(room);
			}, IDLE_TABLE_TTL_MS).unref();
		}
	}

	const sockets = new WebSocketServer({noServer: true, maxPayload: 4096});
	sockets.on('connection', (socket) => {
		let joined = null;
		const helloTimeout = setTimeout(() => socket.close(4001, 'unauthorized'), HELLO_TIMEOUT_MS);
		socket.on('error', () => socket.terminate());
		socket.on('message', (raw) => {
			let message;
			try {
				message = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (!message || typeof message !== 'object') return;
			if (!joined) {
				if (message.t !== 'hello') return;
				clearTimeout(helloTimeout);
				joined = hello(socket, message);
				return;
			}
			const error = handle(joined.entry.table, socket.user.userId, socket.user, message);
			if (error) socket.send(JSON.stringify({t: 'error', code: error}));
		});
		socket.on('close', () => {
			clearTimeout(helloTimeout);
			if (joined) leave(joined.entry, joined.room, socket);
		});
	});
	return {sockets, tables};
}

export function startServer({port, apiKey, apiSecret, timing, golfTiming}) {
	const truco = createGameRoom({apiKey, apiSecret, handle: handleTruco, createTable: (callbacks) => new Table({timing, ...callbacks})});
	const golf = createGameRoom({apiKey, apiSecret, handle: handleGolf, createTable: (callbacks) => new GolfTable({timing: golfTiming, ...callbacks})});
	const routes = {'/ws': truco.sockets, '/golf': golf.sockets};
	let lastTick = performance.now();
	const ticker = setInterval(() => {
		const now = performance.now();
		const dt = Math.min(0.25, (now - lastTick) / 1000);
		lastTick = now;
		for (const {table} of golf.tables.values()) table.tick(dt);
	}, GOLF_TICK_MS);
	ticker.unref();

	const server = http.createServer((request, response) => {
		response.writeHead(request.url === '/health' ? 200 : 404).end();
	});
	server.on('upgrade', (request, socket, head) => {
		const route = routes[new URL(request.url, 'http://truco').pathname];
		if (!route) {
			socket.destroy();
			return;
		}
		route.handleUpgrade(request, socket, head, (client) => route.emit('connection', client, request));
	});
	server.on('close', () => clearInterval(ticker));
	return new Promise((resolve) => server.listen(port, () => resolve({server, sockets: truco.sockets, tables: truco.tables, golfSockets: golf.sockets, golfTables: golf.tables})));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const {FLUXER_LIVEKIT_API_KEY: apiKey, FLUXER_LIVEKIT_API_SECRET: apiSecret, PORT = '8080'} = process.env;
	if (!apiKey || !apiSecret) throw new Error('FLUXER_LIVEKIT_API_KEY and FLUXER_LIVEKIT_API_SECRET are required');
	await startServer({port: Number(PORT), apiKey, apiSecret});
	console.log(`truco listening on ${PORT}`);
}
