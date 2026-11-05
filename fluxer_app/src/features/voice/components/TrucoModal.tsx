// SPDX-License-Identifier: AGPL-3.0-or-later

import Accessibility from '@app/features/accessibility/state/Accessibility';
import * as Modal from '@app/features/app/components/dialogs/Modal';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Avatar} from '@app/features/ui/components/Avatar';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Spinner} from '@app/features/ui/components/Spinner';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {
	type Card,
	type GameView,
	type TablePlay,
	type TableView,
	trucoSoundsBetween,
} from '@app/features/voice/components/TrucoEvents';
import styles from '@app/features/voice/components/TrucoModal.module.css';
import trucoSounds, {DEAL_STEP_MS} from '@app/features/voice/components/TrucoSounds';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import voiceEngineV2AppConnectionHostAdapter from '@app/features/voice/engine/v2/VoiceEngineV2AppConnectionHostAdapter';
import type {I18n} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {RobotIcon, SpeakerHighIcon, SpeakerSlashIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

const RECONNECT_DELAY_MS = 2000;
const UNAUTHORIZED_CLOSE_CODE = 4001;
const TEAM_NAME_MAX_LENGTH = 20;
const AVATAR_SIZE = 40;
const PLAY_RADIUS = 21;
const SEAT_RADIUS = 41;
const CARDS_PER_PLAYER = 3;
const CONFETTI_PIECES = 60;
const SHAKE_KEYFRAMES = [0, -10, 9, -7, 5, -3, 0].map((x) => ({transform: `translateX(${x}px)`}));
// O seletor de variação mantém os naipes como texto: sem ele, parte dos sistemas desenha emoji.
const SUIT_SYMBOLS: Record<string, string> = {ouros: '♦\uFE0E', espadas: '♠\uFE0E', copas: '♥\uFE0E', paus: '♣\uFE0E'};
const RED_SUITS = new Set(['ouros', 'copas']);

export const TRUCO_DESCRIPTOR = msg({
	message: 'Play truco',
	comment: 'Label of the voice call button that opens the truco card game. Truco is the name of a card game.',
});
const CONNECTING_DESCRIPTOR = msg({
	message: 'Connecting to the table…',
	comment: 'Shown while the truco game connects to its server.',
});
const UNAVAILABLE_DESCRIPTOR = msg({
	message: 'Truco is not available in peer-to-peer calls',
	comment: 'Shown when the truco game cannot start because the voice call is peer-to-peer.',
});
const CONNECTION_LOST_DESCRIPTOR = msg({
	message: 'Connection lost. Trying again…',
	comment: 'Shown when the connection to the truco server drops.',
});
const MODE_4_DESCRIPTOR = msg({message: '2 vs 2', comment: 'Truco table size: two teams of two players.'});
const MODE_6_DESCRIPTOR = msg({message: '3 vs 3', comment: 'Truco table size: two teams of three players.'});
const TEAM_DESCRIPTOR = msg({message: 'Team {team}', comment: 'Truco team name. {team} is 1 or 2.'});
const TEAM_NAME_DESCRIPTOR = msg({
	message: 'Team name',
	comment: 'Accessible label of the field that names a truco team.',
});
const MUTE_DESCRIPTOR = msg({message: 'Mute table sounds', comment: 'Button that silences the truco game.'});
const UNMUTE_DESCRIPTOR = msg({message: 'Unmute table sounds', comment: 'Button that brings back the truco sounds.'});
const SIT_DESCRIPTOR = msg({message: 'Sit here', comment: 'Button that takes an empty seat at the truco table.'});
const LEAVE_SEAT_DESCRIPTOR = msg({message: 'Leave seat', comment: 'Button that leaves a seat at the truco table.'});
const START_DESCRIPTOR = msg({message: 'Start game', comment: 'Button that starts a truco game.'});
const BOTS_HINT_DESCRIPTOR = msg({
	message: 'Bots fill the empty seats.',
	comment: 'Hint in the truco lobby explaining what happens to empty seats.',
});
const END_GAME_DESCRIPTOR = msg({
	message: 'End game',
	comment: 'Button that ends the running truco game for everyone.',
});
const WON_DESCRIPTOR = msg({
	message: '{team} won {winner} to {loser}',
	comment: 'Result of the last truco game. {team} is the name of the team, the others are final scores.',
});
const YOUR_TURN_DESCRIPTOR = msg({message: 'Your turn', comment: 'Truco status when the user must play.'});
const WAITING_DESCRIPTOR = msg({
	message: 'Waiting for {name}',
	comment: 'Truco status while another player must act.',
});
const HAND_VALUE_DESCRIPTOR = msg({
	message: 'Hand worth {value}',
	comment: 'How many points the current truco hand is worth.',
});
const CALLED_DESCRIPTOR = msg({
	message: '{name} called {value}',
	comment: 'Truco status when a player raises the hand. {value} is the points being asked.',
});
const RAISE_3_DESCRIPTOR = msg({message: 'Truco!', comment: 'Truco call that raises the hand to 3 points.'});
const RAISE_6_DESCRIPTOR = msg({message: 'Six!', comment: 'Truco call that raises the hand to 6 points.'});
const RAISE_9_DESCRIPTOR = msg({message: 'Nine!', comment: 'Truco call that raises the hand to 9 points.'});
const RAISE_12_DESCRIPTOR = msg({message: 'Twelve!', comment: 'Truco call that raises the hand to 12 points.'});
const ACCEPT_DESCRIPTOR = msg({message: 'Accept raise', comment: 'Truco answer that accepts the raise.'});
const RUN_DESCRIPTOR = msg({message: 'Fold hand', comment: 'Truco answer that gives up the hand.'});
const ELEVEN_DESCRIPTOR = msg({
	message: 'Hand of eleven: play for 3 points or fold and give 1?',
	comment: 'Truco question for the team that has 11 points.',
});
const ELEVEN_PLAY_DESCRIPTOR = msg({message: 'Play the hand', comment: 'Truco answer that plays the hand of eleven.'});
const ELEVEN_WAIT_DESCRIPTOR = msg({
	message: '{team} is deciding the hand of eleven',
	comment: 'Truco status while the team with 11 points decides. {team} is the name of the team.',
});
const IRON_DESCRIPTOR = msg({
	message: 'Iron hand: everyone plays blind',
	comment: 'Truco status when both teams have 11 points and nobody can see their cards.',
});
const FACE_DOWN_DESCRIPTOR = msg({
	message: 'Play face down',
	comment: 'Truco toggle: the next card is played hidden and loses to any other card.',
});
const SCORED_DESCRIPTOR = msg({
	message: '{team} scored {points}',
	comment: 'Truco status at the end of a hand. {team} is the name of the team.',
});
const WATCHING_DESCRIPTOR = msg({
	message: 'You are watching. Take the seat of a bot to play.',
	comment: 'Truco status for someone without a seat in the running game.',
});
const TAKE_SEAT_DESCRIPTOR = msg({
	message: 'Take this seat',
	comment: 'Button that replaces a truco bot in the running game.',
});
const VIRA_DESCRIPTOR = msg({
	message: 'Vira',
	comment: 'The face-up truco card that defines the trump rank. Keep the Portuguese word.',
});
const PARTNER_DESCRIPTOR = msg({
	message: 'Partner:',
	comment: 'Label before the cards of the partner, shown in the truco hand of eleven.',
});

type ConnectionStatus = 'unavailable' | 'connecting' | 'open' | 'lost';
type TrucoSend = (message: Record<string, unknown>) => void;

const RAISE_DESCRIPTORS = {
	3: RAISE_3_DESCRIPTOR,
	6: RAISE_6_DESCRIPTOR,
	9: RAISE_9_DESCRIPTOR,
	12: RAISE_12_DESCRIPTOR,
} as const;
const NEXT_RAISE: Record<number, keyof typeof RAISE_DESCRIPTORS> = {1: 3, 3: 6, 6: 9, 9: 12};

function useTrucoTable(): {state: TableView | null; status: ConnectionStatus; send: TrucoSend} {
	const [state, setState] = useState<TableView | null>(null);
	const [status, setStatus] = useState<ConnectionStatus>('connecting');
	const socketRef = useRef<WebSocket | null>(null);
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
			const socket = new WebSocket(`${endpoint}/truco/ws`);
			socketRef.current = socket;
			socket.onopen = () => {
				socket.send(JSON.stringify({t: 'hello', token, name}));
				setStatus('open');
			};
			socket.onmessage = (event) => {
				const message = JSON.parse(event.data as string) as {t: string; state?: TableView};
				if (message.t === 'state' && message.state) setState(message.state);
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
	}, [channelId, guildId]);
	const send = useCallback<TrucoSend>((message) => {
		if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
	}, []);
	return {state, status, send};
}

function cardClasses(card: Card | null, manilha?: string) {
	if (!card) return clsx(styles.card, styles.cardBack);
	return clsx(styles.card, RED_SUITS.has(card.suit) && styles.cardRed, card.rank === manilha && styles.cardManilha);
}

function CardFace({card}: {card: Card}) {
	const suit = SUIT_SYMBOLS[card.suit];
	return (
		<>
			<span className={styles.cardCorner} data-flx="voice.truco-modal.card-face.card-corner">
				<span data-flx="voice.truco-modal.card-face.span">{card.rank}</span>
				<span data-flx="voice.truco-modal.card-face.span--2">{suit}</span>
			</span>
			<span className={styles.cardPip} data-flx="voice.truco-modal.card-face.card-pip">
				{suit}
			</span>
			<span
				className={clsx(styles.cardCorner, styles.cardCornerBottom)}
				data-flx="voice.truco-modal.card-face.card-corner--2"
			>
				<span data-flx="voice.truco-modal.card-face.span--3">{card.rank}</span>
				<span data-flx="voice.truco-modal.card-face.span--4">{suit}</span>
			</span>
		</>
	);
}

function PlayingCard({card, manilha, small}: {card: Card | null; manilha?: string; small?: boolean}) {
	return (
		<span
			className={clsx(cardClasses(card, manilha), small && styles.cardSmall)}
			data-flx="voice.truco-modal.playing-card.card"
		>
			{card ? <CardFace card={card} data-flx="voice.truco-modal.playing-card.card-face" /> : null}
		</span>
	);
}

const teamClass = (team: number) => (team === 0 ? styles.teamA : styles.teamB);

function teamLabel(i18n: I18n, names: TableView['teamNames'], team: number) {
	return names[team] || i18n._(TEAM_DESCRIPTOR, {team: team + 1});
}

// Posição em relação ao jogador, que fica sempre embaixo: 0 é ele, e o resto segue em volta da mesa.
const relativeSeat = (seat: number, you: number | null, players: number) => (seat - (you ?? 0) + players) % players;

function seatPoint(seat: number, you: number | null, players: number, radius: number) {
	const angle = Math.PI / 2 + (relativeSeat(seat, you, players) / players) * 2 * Math.PI;
	return {x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius};
}

const dealDelay = (round: number, relative: number, players: number) =>
	`${(round * players + relative) * DEAL_STEP_MS}ms`;

function TeamNameField({state, team, send}: {state: TableView; team: number; send: TrucoSend}) {
	const {i18n} = useLingui();
	const name = state.teamNames[team];
	if (state.you === null || state.you % 2 !== team) {
		return (
			<span className={styles.lobbyTeamName} data-flx="voice.truco-modal.team-name-field.lobby-team-name">
				{teamLabel(i18n, state.teamNames, team)}
			</span>
		);
	}
	return (
		<Input
			key={name}
			defaultValue={name}
			maxLength={TEAM_NAME_MAX_LENGTH}
			aria-label={i18n._(TEAM_NAME_DESCRIPTOR)}
			placeholder={i18n._(TEAM_DESCRIPTOR, {team: team + 1})}
			onBlur={(event) => {
				if (event.target.value.trim() !== name) send({t: 'teamName', team, name: event.target.value});
			}}
			onKeyDown={(event) => {
				if (event.key === 'Enter') event.currentTarget.blur();
			}}
			data-flx="voice.truco-modal.team-name-field.input"
		/>
	);
}

function SeatAvatar({userId, name, bot}: {userId: string | null; name: string; bot: boolean}) {
	const user = userId ? Users.getUser(userId) : undefined;
	if (user) return <Avatar user={user} size={AVATAR_SIZE} data-flx="voice.truco-modal.seat-avatar.avatar" />;
	return (
		<span className={styles.avatarFallback} data-flx="voice.truco-modal.seat-avatar.avatar-fallback">
			{bot ? <RobotIcon weight="fill" data-flx="voice.truco-modal.seat-avatar.robot-icon" /> : name.charAt(0)}
		</span>
	);
}

function Lobby({state, send}: {state: TableView; send: TrucoSend}) {
	const {i18n} = useLingui();
	const seated = state.you !== null;
	const seatsOf = (team: number) =>
		state.seats.map((seat, index) => ({seat, index})).filter(({index}) => index % 2 === team);
	return (
		<>
			<div className={styles.actions} data-flx="voice.truco-modal.lobby.actions">
				{([4, 6] as const).map((players) => (
					<Button
						key={players}
						small
						variant={state.players === players ? 'primary' : 'secondary'}
						onClick={() => send({t: 'mode', players})}
						data-flx="voice.truco-modal.lobby.button.send"
					>
						{i18n._(players === 4 ? MODE_4_DESCRIPTOR : MODE_6_DESCRIPTOR)}
					</Button>
				))}
			</div>
			<div className={styles.lobbySeats} data-flx="voice.truco-modal.lobby.lobby-seats">
				{[0, 1].map((team) => (
					<div
						key={team}
						className={clsx(styles.lobbyTeam, teamClass(team))}
						data-flx="voice.truco-modal.lobby.lobby-team"
					>
						<TeamNameField state={state} team={team} send={send} data-flx="voice.truco-modal.lobby.team-name-field" />
						{seatsOf(team).map(({seat, index}) =>
							seat ? (
								<Button
									key={index}
									small
									variant="secondary"
									disabled={state.you !== index}
									onClick={() => send({t: 'stand'})}
									data-flx="voice.truco-modal.lobby.button.send--2"
								>
									{state.you === index ? i18n._(LEAVE_SEAT_DESCRIPTOR) : seat.name}
								</Button>
							) : (
								<Button
									key={index}
									small
									variant="secondary"
									onClick={() => send({t: 'sit', seat: index})}
									data-flx="voice.truco-modal.lobby.button.send--3"
								>
									{i18n._(SIT_DESCRIPTOR)}
								</Button>
							),
						)}
					</div>
				))}
			</div>
			<p className={styles.hint} data-flx="voice.truco-modal.lobby.hint">
				{i18n._(BOTS_HINT_DESCRIPTOR)}
			</p>
			{state.lastResult ? (
				<p className={styles.status} data-flx="voice.truco-modal.lobby.status">
					{i18n._(WON_DESCRIPTOR, {
						team: teamLabel(i18n, state.teamNames, state.lastResult.winner),
						winner: state.lastResult.score[state.lastResult.winner],
						loser: state.lastResult.score[1 - state.lastResult.winner],
					})}
				</p>
			) : null}
			<div className={styles.actions} data-flx="voice.truco-modal.lobby.actions--2">
				<Button disabled={!seated} onClick={() => send({t: 'start'})} data-flx="voice.truco-modal.lobby.button.send--4">
					{i18n._(START_DESCRIPTOR)}
				</Button>
			</div>
		</>
	);
}

function TrickMarkers({results}: {results: GameView['trickResults']}) {
	return (
		<div className={styles.tricks} aria-hidden data-flx="voice.truco-modal.trick-markers.tricks">
			{[0, 1, 2].map((trick) => {
				const result = results[trick];
				return (
					<span
						key={trick}
						className={clsx(
							styles.trick,
							typeof result === 'number' && [styles.trickDone, teamClass(result)],
							result === 'tie' && styles.trickTied,
						)}
						data-flx="voice.truco-modal.trick-markers.trick"
					/>
				);
			})}
		</div>
	);
}

function Confetti({team}: {team: number}) {
	return (
		<div className={clsx(styles.confetti, teamClass(team))} aria-hidden data-flx="voice.truco-modal.confetti.confetti">
			{Array.from({length: CONFETTI_PIECES}, (_, piece) => (
				<i
					key={piece}
					style={
						{
							'--left': `${(piece * 37) % 100}%`,
							'--delay': `${(piece * 53) % 900}ms`,
							'--spin': `${180 + ((piece * 71) % 540)}deg`,
						} as React.CSSProperties
					}
					data-flx="voice.truco-modal.confetti.i"
				/>
			))}
		</div>
	);
}

function PlayOnTable({
	play,
	game,
	you,
	trickOver,
}: {
	play: TablePlay;
	game: GameView;
	you: number | null;
	trickOver: boolean;
}) {
	const from = seatPoint(play.seat, you, game.players, SEAT_RADIUS);
	const to = seatPoint(play.seat, you, game.players, PLAY_RADIUS);
	const winner = game.lastTrickWinner === null ? null : seatPoint(game.lastTrickWinner, you, game.players, SEAT_RADIUS);
	const style = {
		'--from-left': `${from.x}%`,
		'--from-top': `${from.y}%`,
		'--to-left': `${to.x}%`,
		'--to-top': `${to.y}%`,
		'--win-left': `${winner?.x ?? 50}%`,
		'--win-top': `${winner?.y ?? 50}%`,
		'--tilt': `${((play.seat * 37) % 13) - 6}deg`,
	} as React.CSSProperties;
	return (
		<div
			className={clsx(
				styles.play,
				trickOver && styles.playCollected,
				trickOver && play.seat === game.lastTrickWinner && styles.playWinner,
			)}
			style={style}
			data-flx="voice.truco-modal.play-on-table.play"
		>
			<PlayingCard
				card={play.card}
				manilha={game.manilha}
				small
				data-flx="voice.truco-modal.play-on-table.playing-card"
			/>
		</div>
	);
}

function GameTable({state, game, send}: {state: TableView; game: GameView; send: TrucoSend}) {
	const {i18n} = useLingui();
	const [faceDown, setFaceDown] = useState(false);
	const [muted, setMuted] = useState(trucoSounds.muted);
	const tableRef = useRef<HTMLDivElement>(null);
	const {you, seats, teamNames} = state;
	const {players, handNumber} = game;
	const yourTeam = you === null ? null : you % 2;
	const canPlay = game.phase === 'play' && game.turn === you;
	const canAnswer = game.phase === 'raise' && game.raise?.awaiting === yourTeam;
	const canDecideEleven = game.phase === 'eleven' && game.elevenTeam === yourTeam;
	const trickOver = game.table.length === 0;
	const shownPlays = trickOver ? game.lastTrick : game.table;
	// A carta que fecha a vaza chega junto com o resultado: a mesma chave deixa as outras paradas no lugar.
	const trickNumber = game.trickResults.length - (trickOver ? 1 : 0);
	const action = (body: Record<string, unknown>) => send({t: 'action', action: body});
	const actingName = state.actingSeat === null ? '' : (seats[state.actingSeat]?.name ?? '');
	const proposed = game.raise?.proposed;

	useEffect(() => {
		if (proposed && !Accessibility.useReducedMotion) tableRef.current?.animate(SHAKE_KEYFRAMES, {duration: 480});
	}, [proposed]);

	let status: string;
	if (game.ended) {
		status = i18n._(SCORED_DESCRIPTOR, {team: teamLabel(i18n, teamNames, game.ended.team), points: game.ended.points});
	} else if (game.phase === 'raise' && game.raise) {
		status = i18n._(CALLED_DESCRIPTOR, {name: seats[game.raise.seat]?.name ?? '', value: game.raise.proposed});
	} else if (canDecideEleven) {
		status = i18n._(ELEVEN_DESCRIPTOR);
	} else if (game.phase === 'eleven') {
		status = i18n._(ELEVEN_WAIT_DESCRIPTOR, {team: teamLabel(i18n, teamNames, game.elevenTeam ?? 0)});
	} else if (canPlay) {
		status = i18n._(YOUR_TURN_DESCRIPTOR);
	} else {
		status = i18n._(WAITING_DESCRIPTOR, {name: actingName});
	}

	let banner: {key: string; text: string; large: boolean} | null = null;
	if (game.winner !== null) {
		const text = i18n._(WON_DESCRIPTOR, {
			team: teamLabel(i18n, teamNames, game.winner),
			winner: game.score[game.winner],
			loser: game.score[1 - game.winner],
		});
		banner = {key: 'won', text, large: false};
	} else if (game.ended) {
		banner = {key: `ended:${handNumber}`, text: status, large: false};
	} else if (proposed) {
		const text = i18n._(RAISE_DESCRIPTORS[proposed as keyof typeof RAISE_DESCRIPTORS]);
		banner = {key: `raise:${handNumber}:${proposed}`, text, large: true};
	}

	const turnKey = [handNumber, game.trickResults.length, game.table.length, game.phase, proposed, state.actingSeat];
	const raiseAfterProposed = game.raise ? NEXT_RAISE[game.raise.proposed] : undefined;
	const nextRaise = NEXT_RAISE[game.value];
	const dealEnd = `${players * CARDS_PER_PLAYER * DEAL_STEP_MS}ms`;
	return (
		<>
			<div className={styles.topBar} data-flx="voice.truco-modal.game-table.top-bar">
				<div className={styles.score} data-flx="voice.truco-modal.game-table.score">
					{[0, 1].map((team) => (
						<div
							key={team}
							className={clsx(styles.teamScore, teamClass(team), team === yourTeam && styles.teamYou)}
							data-flx="voice.truco-modal.game-table.team-score"
						>
							<span className={styles.teamScoreName} data-flx="voice.truco-modal.game-table.team-score-name">
								{teamLabel(i18n, teamNames, team)}
							</span>
							<span
								key={`score:${game.score[team]}`}
								className={styles.teamScoreValue}
								data-flx="voice.truco-modal.game-table.team-score-value"
							>
								{game.score[team]}
							</span>
							{game.ended?.team === team ? (
								<span
									key={`points:${handNumber}`}
									className={styles.pointsPop}
									data-flx="voice.truco-modal.game-table.points-pop"
								>
									+{game.ended.points}
								</span>
							) : null}
						</div>
					))}
				</div>
				<TrickMarkers results={game.trickResults} data-flx="voice.truco-modal.game-table.trick-markers" />
				<div className={styles.topActions} data-flx="voice.truco-modal.game-table.top-actions">
					<Button
						square
						small
						variant="secondary"
						aria-label={i18n._(muted ? UNMUTE_DESCRIPTOR : MUTE_DESCRIPTOR)}
						icon={
							muted ? (
								<SpeakerSlashIcon data-flx="voice.truco-modal.game-table.speaker-slash-icon" />
							) : (
								<SpeakerHighIcon data-flx="voice.truco-modal.game-table.speaker-high-icon" />
							)
						}
						onClick={() => {
							trucoSounds.muted = !muted;
							setMuted(!muted);
						}}
						data-flx="voice.truco-modal.game-table.button.set-muted"
					/>
					<Button
						small
						variant="secondary"
						disabled={you === null}
						onClick={() => send({t: 'stop'})}
						data-flx="voice.truco-modal.game-table.button.send"
					>
						{i18n._(END_GAME_DESCRIPTOR)}
					</Button>
				</div>
			</div>
			<div ref={tableRef} className={styles.table} data-flx="voice.truco-modal.game-table.table">
				<div className={styles.tableCenter} data-flx="voice.truco-modal.game-table.table-center">
					<div
						key={`vira:${handNumber}`}
						className={styles.vira}
						style={{'--deal-end': dealEnd} as React.CSSProperties}
						data-flx="voice.truco-modal.game-table.vira"
					>
						<PlayingCard card={game.vira} small data-flx="voice.truco-modal.game-table.playing-card" />
						<span data-flx="voice.truco-modal.game-table.span">{i18n._(VIRA_DESCRIPTOR)}</span>
					</div>
					<span
						key={`chip:${game.value}`}
						className={styles.chip}
						title={i18n._(HAND_VALUE_DESCRIPTOR, {value: game.value})}
						data-flx="voice.truco-modal.game-table.chip"
					>
						{game.value}
					</span>
				</div>
				{shownPlays.map((play) => (
					<PlayOnTable
						key={`${handNumber}:${trickNumber}:${play.seat}`}
						play={play}
						game={game}
						you={you}
						trickOver={trickOver}
						data-flx="voice.truco-modal.game-table.play-on-table"
					/>
				))}
				{seats.map((seat, index) => {
					if (!seat) return null;
					const point = seatPoint(index, you, players, SEAT_RADIUS);
					const relative = relativeSeat(index, you, players);
					const acting = state.actingSeat === index;
					const canTakeSeat = you === null && seat.bot;
					return (
						<div
							key={index}
							className={clsx(
								styles.seat,
								teamClass(index % 2),
								acting && styles.seatActive,
								!seat.online && styles.seatAway,
							)}
							style={{left: `${point.x}%`, top: `${point.y}%`}}
							data-flx="voice.truco-modal.game-table.seat"
						>
							<span className={styles.seatAvatar} data-flx="voice.truco-modal.game-table.seat-avatar">
								<SeatAvatar
									userId={seat.userId}
									name={seat.name}
									bot={seat.bot}
									data-flx="voice.truco-modal.game-table.seat-avatar--2"
								/>
							</span>
							<span className={styles.seatName} data-flx="voice.truco-modal.game-table.seat-name">
								{seat.name}
							</span>
							{acting && !seat.bot && seat.online ? (
								<span
									key={turnKey.join(':')}
									className={styles.turnBar}
									style={{'--turn-ms': `${state.turnMs}ms`} as React.CSSProperties}
									data-flx="voice.truco-modal.game-table.turn-bar"
								/>
							) : null}
							{relative !== 0 && !canTakeSeat ? (
								<span className={styles.fan} data-flx="voice.truco-modal.game-table.fan">
									{Array.from({length: game.cardCounts[index]}, (_, card) => (
										<span
											key={`${handNumber}:${card}`}
											className={styles.fanCard}
											style={
												{
													'--deal-x': 50 - point.x,
													'--deal-y': 50 - point.y,
													'--deal-delay': dealDelay(card, relative, players),
													'--fan-tilt': `${(card - (game.cardCounts[index] - 1) / 2) * 12}deg`,
												} as React.CSSProperties
											}
											data-flx="voice.truco-modal.game-table.fan-card"
										/>
									))}
								</span>
							) : null}
							{canTakeSeat ? (
								<Button
									small
									variant="secondary"
									onClick={() => send({t: 'sit', seat: index})}
									data-flx="voice.truco-modal.game-table.button.send--2"
								>
									{i18n._(TAKE_SEAT_DESCRIPTOR)}
								</Button>
							) : null}
						</div>
					);
				})}
				{banner ? (
					<div className={styles.banner} data-flx="voice.truco-modal.game-table.banner">
						<span
							key={banner.key}
							className={clsx(styles.bannerText, banner.large && styles.bannerLarge)}
							data-flx="voice.truco-modal.game-table.banner-text"
						>
							{banner.text}
						</span>
					</div>
				) : null}
				{game.winner !== null ? <Confetti team={game.winner} data-flx="voice.truco-modal.game-table.confetti" /> : null}
			</div>
			<p className={styles.status} data-flx="voice.truco-modal.game-table.status">
				{game.blind ? `${i18n._(IRON_DESCRIPTOR)} · ${status}` : status}
			</p>
			{you === null ? (
				<p className={styles.hint} data-flx="voice.truco-modal.game-table.hint">
					{i18n._(WATCHING_DESCRIPTOR)}
				</p>
			) : null}
			{game.partners.map((partner) => (
				<div key={partner.seat} className={styles.partner} data-flx="voice.truco-modal.game-table.partner">
					<span data-flx="voice.truco-modal.game-table.span--3">{i18n._(PARTNER_DESCRIPTOR)}</span>
					{partner.cards.map((card) => (
						<PlayingCard
							key={`${card.rank}${card.suit}`}
							card={card}
							manilha={game.manilha}
							small
							data-flx="voice.truco-modal.game-table.playing-card--3"
						/>
					))}
				</div>
			))}
			<div className={clsx(styles.hand, canPlay && styles.handActive)} data-flx="voice.truco-modal.game-table.hand">
				{game.hand.map((card, index) => (
					<button
						key={`${handNumber}:${card ? `${card.rank}${card.suit}` : index}`}
						type="button"
						className={cardClasses(card, game.manilha)}
						style={{'--deal-delay': dealDelay(index, 0, players)} as React.CSSProperties}
						disabled={!canPlay}
						onClick={() => {
							action({type: 'play', index, hidden: faceDown && game.canHide});
							setFaceDown(false);
						}}
						data-flx="voice.truco-modal.game-table.card.action.button"
					>
						{card ? <CardFace card={card} data-flx="voice.truco-modal.game-table.card-face" /> : null}
					</button>
				))}
			</div>
			<div className={styles.actions} data-flx="voice.truco-modal.game-table.actions">
				{game.canRaise && nextRaise ? (
					<Button small onClick={() => action({type: 'raise'})} data-flx="voice.truco-modal.game-table.button.action">
						{i18n._(RAISE_DESCRIPTORS[nextRaise])}
					</Button>
				) : null}
				{canPlay && game.canHide && !game.blind ? (
					<Button
						small
						variant={faceDown ? 'primary' : 'secondary'}
						onClick={() => setFaceDown(!faceDown)}
						data-flx="voice.truco-modal.game-table.button.set-face-down"
					>
						{i18n._(FACE_DOWN_DESCRIPTOR)}
					</Button>
				) : null}
				{canAnswer ? (
					<>
						<Button
							small
							onClick={() => action({type: 'respond', answer: 'accept'})}
							data-flx="voice.truco-modal.game-table.button.action--2"
						>
							{i18n._(ACCEPT_DESCRIPTOR)}
						</Button>
						{raiseAfterProposed ? (
							<Button
								small
								onClick={() => action({type: 'respond', answer: 'raise'})}
								data-flx="voice.truco-modal.game-table.button.action--3"
							>
								{i18n._(RAISE_DESCRIPTORS[raiseAfterProposed])}
							</Button>
						) : null}
						<Button
							small
							variant="secondary"
							onClick={() => action({type: 'respond', answer: 'run'})}
							data-flx="voice.truco-modal.game-table.button.action--4"
						>
							{i18n._(RUN_DESCRIPTOR)}
						</Button>
					</>
				) : null}
				{canDecideEleven ? (
					<>
						<Button
							small
							onClick={() => action({type: 'eleven', answer: 'play'})}
							data-flx="voice.truco-modal.game-table.button.action--5"
						>
							{i18n._(ELEVEN_PLAY_DESCRIPTOR)}
						</Button>
						<Button
							small
							variant="secondary"
							onClick={() => action({type: 'eleven', answer: 'run'})}
							data-flx="voice.truco-modal.game-table.button.action--6"
						>
							{i18n._(RUN_DESCRIPTOR)}
						</Button>
					</>
				) : null}
			</div>
		</>
	);
}

const TrucoModal: React.FC = observer(() => {
	const {i18n} = useLingui();
	const {state, status, send} = useTrucoTable();
	const previousState = useRef<TableView | null>(null);
	useEffect(() => {
		if (state) trucoSounds.play(trucoSoundsBetween(previousState.current, state), state.players);
		previousState.current = state;
	}, [state]);
	let content: React.ReactNode;
	if (status === 'unavailable') {
		content = (
			<p className={styles.status} data-flx="voice.truco-modal.status">
				{i18n._(UNAVAILABLE_DESCRIPTOR)}
			</p>
		);
	} else if (!state) {
		content = (
			<div className={styles.center} data-flx="voice.truco-modal.center">
				<Spinner data-flx="voice.truco-modal.spinner" />
			</div>
		);
	} else if (state.game) {
		content = <GameTable state={state} game={state.game} send={send} data-flx="voice.truco-modal.game-table" />;
	} else {
		content = <Lobby state={state} send={send} data-flx="voice.truco-modal.lobby" />;
	}
	return (
		<Modal.Root size="large" centered data-flx="voice.truco-modal.modal-root">
			<Modal.Header
				title={i18n._(TRUCO_DESCRIPTOR)}
				onClose={ModalCommands.pop}
				data-flx="voice.truco-modal.modal-header"
			/>
			<Modal.Content padding="default" data-flx="voice.truco-modal.modal-content">
				<div className={styles.body} data-flx="voice.truco-modal.body">
					{status === 'lost' ? (
						<p className={styles.status} data-flx="voice.truco-modal.status--2">
							{i18n._(CONNECTION_LOST_DESCRIPTOR)}
						</p>
					) : null}
					{status === 'connecting' && !state ? (
						<p className={styles.status} data-flx="voice.truco-modal.status--3">
							{i18n._(CONNECTING_DESCRIPTOR)}
						</p>
					) : null}
					{content}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
});

TrucoModal.displayName = 'TrucoModal';

export function openTrucoModal(): void {
	ModalCommands.push(
		ModalCommands.modal(() => <TrucoModal data-flx="voice.truco-modal.open-truco-modal.truco-modal" />),
	);
}
