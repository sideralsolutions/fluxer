// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {wrapDesktopLocalResourceURL} from '@app/features/messaging/utils/DesktopResourceUrl';
import {ENTRANCE_SOUND_NAME_MAX_LENGTH} from '@fluxer/constants/src/EntranceSoundConstants';

// Myinstants sends no CORS headers and the CSP blocks it, so the instance edge proxies these two paths. Using the
// absolute instance URL also lets the desktop renderer, which has a local origin, reach them through its resource proxy.
const PROXY_PATH = '/myinstants';
const SOUND_HOST = 'www.myinstants.com';
const SOUND_PATH_PREFIX = '/media/sounds/';

export interface MyInstantsSound {
	slug: string;
	name: string;
	url: string;
}

export interface MyInstantsPage {
	sounds: Array<MyInstantsSound>;
	hasMore: boolean;
}

function proxyBase(): string {
	return `${RuntimeConfig.webAppEndpoint.replace(/\/+$/, '')}${PROXY_PATH}`;
}

function toProxiedSoundUrl(sound: unknown): string | null {
	if (typeof sound !== 'string' || !URL.canParse(sound)) return null;
	const url = new URL(sound);
	if (url.protocol !== 'https:' || url.hostname !== SOUND_HOST || !url.pathname.startsWith(SOUND_PATH_PREFIX)) {
		return null;
	}
	return `${proxyBase()}${url.pathname}`;
}

function toSoundName(name: string): string {
	return name
		.trim()
		.slice(0, ENTRANCE_SOUND_NAME_MAX_LENGTH)
		.replace(/[\uD800-\uDBFF]$/, '')
		.trim();
}

export function parseMyInstantsPage(body: unknown): MyInstantsPage {
	const {results, next} = (body ?? {}) as {results?: unknown; next?: unknown};
	const sounds: Array<MyInstantsSound> = [];
	for (const row of Array.isArray(results) ? results : []) {
		const {slug, name, sound} = (row ?? {}) as Record<string, unknown>;
		const url = toProxiedSoundUrl(sound);
		if (typeof slug !== 'string' || !slug || !url) continue;
		sounds.push({slug, name: toSoundName(typeof name === 'string' && name.trim() ? name : slug), url});
	}
	return {sounds, hasMore: typeof next === 'string'};
}

export async function searchMyInstants(query: string, page: number, signal: AbortSignal): Promise<MyInstantsPage> {
	const params = new URLSearchParams({format: 'json', page: String(page)});
	const name = query.trim();
	if (name) params.set('name', name);
	const response = await fetch(wrapDesktopLocalResourceURL(`${proxyBase()}/api/v1/instants/?${params}`), {signal});
	if (!response.ok) throw new Error(`Myinstants search failed with status ${response.status}`);
	return parseMyInstantsPage(await response.json());
}
