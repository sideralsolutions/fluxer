// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import RuntimeConfig from '@app/features/app/state/RuntimeConfig';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Spinner} from '@app/features/ui/components/Spinner';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import styles from '@app/features/voice/components/TrucoModal.module.css';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import voiceEngineV2AppConnectionHostAdapter from '@app/features/voice/engine/v2/VoiceEngineV2AppConnectionHostAdapter';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

const RECONNECT_DELAY_MS = 2000;
const UNAUTHORIZED_CLOSE_CODE = 4001;
const SUIT_SYMBOLS: Record<string, string> = {ouros: '♦', espadas: '♠', copas: '♥', paus: '♣'};
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
	message: 'Team {team} won {winner} to {loser}',
	comment: 'Result of the last truco game. {team} is 1 or 2, the others are final scores.',
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
	message: 'Team {team} is deciding the hand of eleven',
	comment: 'Truco status while the team with 11 points decides.',
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
	message: 'Team {team} scored {points}',
	comment: 'Truco status at the end of a hand.',
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

interface Card {
	rank: string;
	suit: string;
}

interface TablePlay {
	seat: number;
	hidden: boolean;
	card: Card | null;
}

interface GameView {
	players: number;
	score: [number, number];
	vira: Card;
	manilha: string;
	turn: number;
	value: number;
	phase: 'play' | 'raise' | 'eleven' | 'ended';
	raise: {by: number; seat: number; proposed: number; awaiting: number} | null;
	elevenTeam: number | null;
	blind: boolean;
	ended: {team: number; points: number; reason: string} | null;
	canRaise: boolean;
	canHide: boolean;
	lastTrick: Array<TablePlay>;
	table: Array<TablePlay>;
	hand: Array<Card | null>;
	cardCounts: Array<number>;
	partners: Array<{seat: number; cards: Array<Card>}>;
}

interface SeatView {
	name: string;
	bot: boolean;
	online: boolean;
}

interface TableView {
	players: number;
	seats: Array<SeatView | null>;
	you: number | null;
	lastResult: {score: [number, number]; winner: number} | null;
	game: GameView | null;
	actingSeat: number | null;
}

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

function PlayingCard({card, manilha, small}: {card: Card | null; manilha?: string; small?: boolean}) {
	if (!card)
		return (
			<span
				className={clsx(styles.card, styles.cardBack, small && styles.cardSmall)}
				data-flx="voice.truco-modal.playing-card.card"
			/>
		);
	return (
		<span
			className={clsx(
				styles.card,
				small && styles.cardSmall,
				RED_SUITS.has(card.suit) && styles.cardRed,
				card.rank === manilha && styles.cardManilha,
			)}
			data-flx="voice.truco-modal.playing-card.card--2"
		>
			<span data-flx="voice.truco-modal.playing-card.span">{card.rank}</span>
			<span data-flx="voice.truco-modal.playing-card.span--2">{SUIT_SYMBOLS[card.suit]}</span>
		</span>
	);
}

// Assento na borda da mesa, com quem joga sempre embaixo: 0 é o próprio jogador, e o resto segue em volta.
function seatPosition(seat: number, you: number | null, players: number, radius: number) {
	const relative = (seat - (you ?? 0) + players) % players;
	const angle = Math.PI / 2 + (relative / players) * 2 * Math.PI;
	return {left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius}%`};
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
					<div key={team} className={styles.lobbyTeam} data-flx="voice.truco-modal.lobby.lobby-team">
						<span className={styles.lobbyTeamName} data-flx="voice.truco-modal.lobby.lobby-team-name">
							{i18n._(TEAM_DESCRIPTOR, {team: team + 1})}
						</span>
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
						team: state.lastResult.winner + 1,
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

function GameTable({state, game, send}: {state: TableView; game: GameView; send: TrucoSend}) {
	const {i18n} = useLingui();
	const [faceDown, setFaceDown] = useState(false);
	const {you, seats} = state;
	const yourTeam = you === null ? null : you % 2;
	const canPlay = game.phase === 'play' && game.turn === you;
	const canAnswer = game.phase === 'raise' && game.raise?.awaiting === yourTeam;
	const canDecideEleven = game.phase === 'eleven' && game.elevenTeam === yourTeam;
	const shownPlays = game.phase === 'ended' && game.table.length === 0 ? game.lastTrick : game.table;
	const action = (body: Record<string, unknown>) => send({t: 'action', action: body});
	const actingName = state.actingSeat === null ? '' : (seats[state.actingSeat]?.name ?? '');

	let status: string;
	if (game.ended) {
		status = i18n._(SCORED_DESCRIPTOR, {team: game.ended.team + 1, points: game.ended.points});
	} else if (game.phase === 'raise' && game.raise) {
		status = i18n._(CALLED_DESCRIPTOR, {name: seats[game.raise.seat]?.name ?? '', value: game.raise.proposed});
	} else if (canDecideEleven) {
		status = i18n._(ELEVEN_DESCRIPTOR);
	} else if (game.phase === 'eleven') {
		status = i18n._(ELEVEN_WAIT_DESCRIPTOR, {team: (game.elevenTeam ?? 0) + 1});
	} else if (canPlay) {
		status = i18n._(YOUR_TURN_DESCRIPTOR);
	} else {
		status = i18n._(WAITING_DESCRIPTOR, {name: actingName});
	}

	const raiseAfterProposed = game.raise ? NEXT_RAISE[game.raise.proposed] : undefined;
	const nextRaise = NEXT_RAISE[game.value];
	return (
		<>
			<div className={styles.topBar} data-flx="voice.truco-modal.game-table.top-bar">
				<div className={styles.score} data-flx="voice.truco-modal.game-table.score">
					{[0, 1].map((team) => (
						<span
							key={team}
							className={clsx(team === yourTeam && styles.teamYou)}
							data-flx="voice.truco-modal.game-table.team-you"
						>
							{i18n._(TEAM_DESCRIPTOR, {team: team + 1})}: {game.score[team]}
						</span>
					))}
				</div>
				<span data-flx="voice.truco-modal.game-table.span">{i18n._(HAND_VALUE_DESCRIPTOR, {value: game.value})}</span>
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
			<div className={styles.table} data-flx="voice.truco-modal.game-table.table">
				<div className={styles.vira} data-flx="voice.truco-modal.game-table.vira">
					<PlayingCard card={game.vira} small data-flx="voice.truco-modal.game-table.playing-card" />
					<span data-flx="voice.truco-modal.game-table.span--2">{i18n._(VIRA_DESCRIPTOR)}</span>
				</div>
				{shownPlays.map((play) => (
					<div
						key={play.seat}
						className={styles.play}
						style={seatPosition(play.seat, you, game.players, 24)}
						data-flx="voice.truco-modal.game-table.play"
					>
						<PlayingCard
							card={play.card}
							manilha={game.manilha}
							small
							data-flx="voice.truco-modal.game-table.playing-card--2"
						/>
					</div>
				))}
				{seats.map((seat, index) =>
					seat ? (
						<div
							key={index}
							className={clsx(styles.seat, state.actingSeat === index && styles.seatActive)}
							style={seatPosition(index, you, game.players, 42)}
							data-flx="voice.truco-modal.game-table.seat"
						>
							<span className={styles.seatName} data-flx="voice.truco-modal.game-table.seat-name">
								{seat.name}
							</span>
							<span className={styles.seatMeta} data-flx="voice.truco-modal.game-table.seat-meta">
								{i18n._(TEAM_DESCRIPTOR, {team: (index % 2) + 1})} · {game.cardCounts[index]}🂠
							</span>
							{you === null && seat.bot ? (
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
					) : null,
				)}
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
			<div className={styles.hand} data-flx="voice.truco-modal.game-table.hand">
				{game.hand.map((card, index) => (
					<button
						key={card ? `${card.rank}${card.suit}` : index}
						type="button"
						className={clsx(
							styles.card,
							card && RED_SUITS.has(card.suit) && styles.cardRed,
							card?.rank === game.manilha && styles.cardManilha,
							!card && styles.cardBack,
						)}
						disabled={!canPlay}
						onClick={() => {
							action({type: 'play', index, hidden: faceDown && game.canHide});
							setFaceDown(false);
						}}
						data-flx="voice.truco-modal.game-table.card.action.button"
					>
						{card ? (
							<>
								<span data-flx="voice.truco-modal.game-table.span--4">{card.rank}</span>
								<span data-flx="voice.truco-modal.game-table.span--5">{SUIT_SYMBOLS[card.suit]}</span>
							</>
						) : null}
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
