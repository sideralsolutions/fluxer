// SPDX-License-Identifier: AGPL-3.0-or-later

import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import voiceEngineV2AppConnectionHostAdapter from '@app/features/voice/engine/v2/VoiceEngineV2AppConnectionHostAdapter';
import {useCallback, useEffect, useRef, useState} from 'react';

const RECONNECT_DELAY_MS = 2000;
const UNAUTHORIZED_CLOSE_CODE = 4001;

export type ConnectionStatus = 'unavailable' | 'connecting' | 'open' | 'lost';
export type GameSend = (message: Record<string, unknown>) => void;

// Conexão com um jogo da chamada. O token de voz prova quem joga e em qual sala.
export function useVoiceGameSocket<State>(
	path: string,
	onMessage?: (message: {t: string}) => void,
): {state: State | null; status: ConnectionStatus; send: GameSend} {
	const [state, setState] = useState<State | null>(null);
	const [status, setStatus] = useState<ConnectionStatus>('connecting');
	const socketRef = useRef<WebSocket | null>(null);
	const onMessageRef = useRef(onMessage);
	onMessageRef.current = onMessage;
	const {channelId, guildId} = MediaEngine;
	useEffect(() => {
		let disposed = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			const token = voiceEngineV2AppConnectionHostAdapter.latestVoiceToken;
			if (!token) {
				setStatus('unavailable');
				return;
			}
			const user = Users.getCurrentUser();
			const name = user ? NicknameUtils.getNickname(user, guildId, channelId ?? undefined) : '';
			const endpoint = RuntimeConfig.webAppEndpoint.replace(/^http/, 'ws').replace(/\/+$/, '');
			const socket = new WebSocket(`${endpoint}${path}`);
			socketRef.current = socket;
			socket.onopen = () => {
				socket.send(JSON.stringify({t: 'hello', token, name}));
				setStatus('open');
			};
			socket.onmessage = (event) => {
				const message = JSON.parse(event.data as string) as {t: string; state?: State};
				if (message.t === 'state' && message.state) setState(message.state);
				else onMessageRef.current?.(message);
			};
			socket.onclose = (event) => {
				if (disposed) return;
				setStatus(event.code === UNAUTHORIZED_CLOSE_CODE ? 'unavailable' : 'lost');
				if (event.code !== UNAUTHORIZED_CLOSE_CODE) retry = setTimeout(connect, RECONNECT_DELAY_MS);
			};
		};
		connect();
		return () => {
			disposed = true;
			clearTimeout(retry);
			socketRef.current?.close();
		};
	}, [channelId, guildId, path]);
	const send = useCallback<GameSend>((message) => {
		if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
	}, []);
	return {state, status, send};
}
