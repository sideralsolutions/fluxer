// SPDX-License-Identifier: AGPL-3.0-or-later

import {createHmac, timingSafeEqual} from 'node:crypto';

// O token de voz dura 10 minutos, mas o jogo pode abrir bem depois de entrar na chamada. A assinatura continua provando
// quem é a pessoa e a sala, então aceitamos tokens vencidos há até 24 h. Ele nunca sai da conexão do próprio dono.
const EXPIRY_GRACE_SECONDS = 24 * 60 * 60;
const IDENTITY = /^user_(\d+)(?:_.+)?$/;

export function verifyVoiceToken(token, {apiKey, apiSecret, now = Date.now()}) {
	if (typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [header, payload, signature] = parts;
	const expected = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest();
	const given = Buffer.from(signature, 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	let claims;
	try {
		if (JSON.parse(Buffer.from(header, 'base64url')).alg !== 'HS256') return null;
		claims = JSON.parse(Buffer.from(payload, 'base64url'));
	} catch {
		return null;
	}
	if (claims.iss !== apiKey) return null;
	if (typeof claims.exp !== 'number' || claims.exp + EXPIRY_GRACE_SECONDS < now / 1000) return null;
	const userId = IDENTITY.exec(claims.sub ?? '')?.[1];
	const room = claims.video?.room;
	if (!userId || typeof room !== 'string' || !room) return null;
	return {userId, room};
}
