// SPDX-License-Identifier: AGPL-3.0-or-later

import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {WebSocketServer} from 'ws';
import {verifyVoiceToken} from './auth.mjs';
import {Table} from './table.mjs';

const NAME_MAX_LENGTH = 32;
const HELLO_TIMEOUT_MS = 10_000;
const IDLE_TABLE_TTL_MS = 30 * 60 * 1000;

export function startServer({port, apiKey, apiSecret, timing}) {
	const tables = new Map();

	function openTable(room) {
		let entry = tables.get(room);
		if (!entry) {
			entry = {sockets: new Set(), cleanup: null, table: null};
			entry.table = new Table({timing, onChange: () => broadcast(entry)});
			tables.set(room, entry);
		}
		clearTimeout(entry.cleanup);
		return entry;
	}

	function broadcast(entry) {
		for (const socket of entry.sockets) {
			socket.send(JSON.stringify({t: 'state', state: entry.table.viewFor(socket.user.userId)}));
		}
	}

	function handle(entry, socket, message) {
		const {table} = entry;
		const {userId} = socket.user;
		switch (message.t) {
			case 'mode':
				return table.setMode(message.players);
			case 'sit':
				return table.sit(socket.user, message.seat);
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
		entry.table.setConnected(identity.userId, true);
		return entry;
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

	const server = http.createServer((request, response) => {
		response.writeHead(request.url === '/health' ? 200 : 404).end();
	});
	const sockets = new WebSocketServer({server, path: '/ws', maxPayload: 4096});
	sockets.on('connection', (socket) => {
		let entry = null;
		let room = null;
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
			if (!entry) {
				if (message.t !== 'hello') return;
				clearTimeout(helloTimeout);
				entry = hello(socket, message);
				room = entry ? verifyVoiceToken(message.token, {apiKey, apiSecret}).room : null;
				return;
			}
			const error = handle(entry, socket, message);
			if (error) socket.send(JSON.stringify({t: 'error', code: error}));
		});
		socket.on('close', () => {
			clearTimeout(helloTimeout);
			if (entry) leave(entry, room, socket);
		});
	});
	return new Promise((resolve) => server.listen(port, () => resolve({server, sockets, tables})));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const {FLUXER_LIVEKIT_API_KEY: apiKey, FLUXER_LIVEKIT_API_SECRET: apiSecret, PORT = '8080'} = process.env;
	if (!apiKey || !apiSecret) throw new Error('FLUXER_LIVEKIT_API_KEY and FLUXER_LIVEKIT_API_SECRET are required');
	await startServer({port: Number(PORT), apiKey, apiSecret});
	console.log(`truco listening on ${PORT}`);
}
