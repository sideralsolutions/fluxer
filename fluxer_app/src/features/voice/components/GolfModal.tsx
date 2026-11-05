// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import {Spinner} from '@app/features/ui/components/Spinner';
import {
	GOLF_COLORS,
	type GolfMode,
	type GolfPlayer,
	type GolfView,
	golfPhaseSounds,
} from '@app/features/voice/components/GolfEvents';
import styles from '@app/features/voice/components/GolfModal.module.css';
import type {GolfCourse, GolfFrame, GolfScene} from '@app/features/voice/components/GolfScene';
import golfSounds from '@app/features/voice/components/GolfSounds';
import {type GameSend, useVoiceGameSocket} from '@app/features/voice/components/VoiceGameSocket';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {SpeakerHighIcon, SpeakerSlashIcon} from '@phosphor-icons/react';
import {clsx} from 'clsx';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';

const SOCKET_PATH = '/truco/golf';
const HOLE_OPTIONS = [3, 6, 9] as const;
const CLOCK_VISIBLE_SECONDS = 60;
const CLOCK_REFRESH_MS = 250;

export const GOLF_DESCRIPTOR = msg({
	message: 'Play golf',
	comment: 'Label of the voice call button that opens the minigolf game.',
});
const TITLE_DESCRIPTOR = msg({message: 'Bola Torta', comment: 'Name of the minigolf game. Keep the Portuguese name.'});
const UNAVAILABLE_DESCRIPTOR = msg({
	message: 'Golf is not available in peer-to-peer calls',
	comment: 'Shown when the minigolf game cannot start because the voice call is peer-to-peer.',
});
const NO_3D_DESCRIPTOR = msg({
	message: 'This device cannot show 3D. Turn on hardware acceleration and open the game again.',
	comment: 'Shown when the minigolf game cannot use WebGL.',
});
const CONNECTION_LOST_DESCRIPTOR = msg({
	message: 'Connection lost. Trying again…',
	comment: 'Shown when the connection to the game server drops.',
});
const MODE_TITLE_DESCRIPTOR = msg({message: 'Game mode', comment: 'Heading above the minigolf mode choices.'});
const CLASSIC_DESCRIPTOR = msg({message: 'Classic', comment: 'Minigolf mode where the fewest strokes win.'});
const CLASSIC_HINT_DESCRIPTOR = msg({
	message: 'Fewest strokes across all courses wins.',
	comment: 'Explains the classic minigolf mode.',
});
const TOURNAMENT_DESCRIPTOR = msg({message: 'Tournament', comment: 'Minigolf elimination mode.'});
const TOURNAMENT_HINT_DESCRIPTOR = msg({
	message: 'The worst player of each course is out, until one is left.',
	comment: 'Explains the minigolf tournament mode.',
});
const RACE_DESCRIPTOR = msg({message: 'Race', comment: 'Minigolf mode where the order of arrival scores points.'});
const RACE_HINT_DESCRIPTOR = msg({
	message: 'First to the hole scores the most points. Strokes do not count.',
	comment: 'Explains the minigolf race mode.',
});
const HOLES_TITLE_DESCRIPTOR = msg({
	message: 'Courses',
	comment: 'Heading above the number of minigolf courses to play.',
});
const PLAYERS_TITLE_DESCRIPTOR = msg({message: 'Players', comment: 'Heading above the list of minigolf players.'});
const JOIN_DESCRIPTOR = msg({message: 'Join game', comment: 'Button that joins the next minigolf game.'});
const LEAVE_DESCRIPTOR = msg({message: 'Leave game', comment: 'Button that leaves the next minigolf game.'});
const ADD_BOT_DESCRIPTOR = msg({message: 'Add bot', comment: 'Button that adds a computer player to minigolf.'});
const REMOVE_BOT_DESCRIPTOR = msg({
	message: 'Remove bot',
	comment: 'Button that removes a computer player from minigolf.',
});
const START_DESCRIPTOR = msg({message: 'Start game', comment: 'Button that starts a truco game.'});
const END_GAME_DESCRIPTOR = msg({
	message: 'End game',
	comment: 'Button that ends the running truco game for everyone.',
});
const NEEDS_OPPONENT_DESCRIPTOR = msg({
	message: 'A tournament needs at least two players. Add a bot or call someone.',
	comment: 'Shown when the minigolf tournament has a single player.',
});
const COURSE_OF_DESCRIPTOR = msg({
	message: 'Course {index} of {count}',
	comment: 'Progress of a minigolf game.',
});
const COURSE_DESCRIPTOR = msg({message: 'Course {index}', comment: 'Progress of a minigolf tournament.'});
const STROKES_DESCRIPTOR = msg({message: 'Strokes', comment: 'Minigolf score column: strokes on this course.'});
const TOTAL_DESCRIPTOR = msg({message: 'Total', comment: 'Minigolf score column: strokes so far.'});
const POINTS_DESCRIPTOR = msg({message: 'Points', comment: 'Minigolf score column: race points.'});
const TIP_DESCRIPTOR = msg({
	message: 'Drag back and release to shoot. Right button or Q and E turn the camera, M shows the course.',
	comment: 'Minigolf controls.',
});
const WATCHING_DESCRIPTOR = msg({
	message: 'You are watching this game.',
	comment: 'Shown to someone in the call who is not in the running minigolf game.',
});
const YOU_ARE_OUT_DESCRIPTOR = msg({
	message: 'You are out. Watch the others finish.',
	comment: 'Shown to a player eliminated from the minigolf tournament.',
});
const SHOW_COURSE_DESCRIPTOR = msg({
	message: 'Show course',
	comment: 'Button that shows the whole minigolf course from above.',
});
const SHOW_BALL_DESCRIPTOR = msg({
	message: 'Back to ball',
	comment: 'Button that returns the minigolf camera to the ball.',
});
const MUTE_DESCRIPTOR = msg({message: 'Mute game sounds', comment: 'Button that silences the minigolf game.'});
const UNMUTE_DESCRIPTOR = msg({message: 'Unmute game sounds', comment: 'Button that brings back the minigolf sounds.'});
const COURSE_DONE_DESCRIPTOR = msg({message: 'Course finished', comment: 'Heading of the minigolf course results.'});
const DID_NOT_FINISH_DESCRIPTOR = msg({
	message: 'Did not finish',
	comment: 'Minigolf result of a player who did not reach the hole.',
});
const ELIMINATED_DESCRIPTOR = msg({
	message: '{names} out of the tournament',
	comment: 'Names of the players eliminated from the minigolf tournament.',
});
const WINNER_DESCRIPTOR = msg({message: '{name} won!', comment: 'Heading of the minigolf final results.'});
const LAST_GAME_DESCRIPTOR = msg({
	message: 'Last game: {name} won',
	comment: 'Result of the previous minigolf game, shown in the lobby.',
});

const MODES: Array<{mode: GolfMode; name: typeof CLASSIC_DESCRIPTOR; hint: typeof CLASSIC_DESCRIPTOR}> = [
	{mode: 'classic', name: CLASSIC_DESCRIPTOR, hint: CLASSIC_HINT_DESCRIPTOR},
	{mode: 'tournament', name: TOURNAMENT_DESCRIPTOR, hint: TOURNAMENT_HINT_DESCRIPTOR},
	{mode: 'race', name: RACE_DESCRIPTOR, hint: RACE_HINT_DESCRIPTOR},
];

const ballColor = (index: number) => `#${GOLF_COLORS[index % GOLF_COLORS.length].toString(16).padStart(6, '0')}`;

function PlayerName({player, index}: {player: GolfPlayer; index: number}) {
	return (
		<>
			<span className={styles.dot} style={{background: ballColor(index)}} data-flx="voice.golf-modal.player-name.dot" />
			<span className={clsx(styles.name, player.out && styles.playerOut)} data-flx="voice.golf-modal.player-name.name">
				{player.name}
			</span>
		</>
	);
}

function Lobby({state, send}: {state: GolfView; send: GameSend}) {
	const {i18n} = useLingui();
	const joined = state.you !== null;
	const needsOpponent = state.mode === 'tournament' && state.players.length < 2;
	const winner = state.lastResult?.ranking[0]?.name;
	return (
		<div className={styles.lobby} data-flx="voice.golf-modal.lobby.lobby">
			<div className={styles.section} data-flx="voice.golf-modal.lobby.section">
				<span className={styles.sectionTitle} data-flx="voice.golf-modal.lobby.section-title">
					{i18n._(MODE_TITLE_DESCRIPTOR)}
				</span>
				<div className={styles.modes} data-flx="voice.golf-modal.lobby.modes">
					{MODES.map(({mode, name, hint}) => (
						<button
							key={mode}
							type="button"
							className={clsx(styles.mode, state.mode === mode && styles.modeActive)}
							disabled={!joined}
							aria-pressed={state.mode === mode}
							onClick={() => send({t: 'configure', mode})}
							data-flx="voice.golf-modal.lobby.mode.send"
						>
							<span className={styles.modeName} data-flx="voice.golf-modal.lobby.mode-name">
								{i18n._(name)}
							</span>
							<span className={styles.modeHint} data-flx="voice.golf-modal.lobby.mode-hint">
								{i18n._(hint)}
							</span>
						</button>
					))}
				</div>
			</div>
			{state.mode === 'tournament' ? null : (
				<div className={styles.section} data-flx="voice.golf-modal.lobby.section--2">
					<span className={styles.sectionTitle} data-flx="voice.golf-modal.lobby.section-title--2">
						{i18n._(HOLES_TITLE_DESCRIPTOR)}
					</span>
					<div className={styles.row} data-flx="voice.golf-modal.lobby.row">
						{HOLE_OPTIONS.map((holes) => (
							<Button
								key={holes}
								small
								disabled={!joined}
								variant={state.holeCount === holes ? 'primary' : 'secondary'}
								onClick={() => send({t: 'configure', holes})}
								data-flx="voice.golf-modal.lobby.button.send"
							>
								{holes}
							</Button>
						))}
					</div>
				</div>
			)}
			<div className={styles.section} data-flx="voice.golf-modal.lobby.section--3">
				<span className={styles.sectionTitle} data-flx="voice.golf-modal.lobby.section-title--3">
					{i18n._(PLAYERS_TITLE_DESCRIPTOR)}
				</span>
				<div className={styles.players} data-flx="voice.golf-modal.lobby.players">
					{state.players.map((player, index) => (
						<div key={player.userId ?? player.name} className={styles.player} data-flx="voice.golf-modal.lobby.player">
							<PlayerName player={player} index={index} data-flx="voice.golf-modal.lobby.player-name" />
						</div>
					))}
				</div>
				<div className={styles.row} data-flx="voice.golf-modal.lobby.row--2">
					<Button
						small
						variant="secondary"
						onClick={() => send({t: joined ? 'leave' : 'join'})}
						data-flx="voice.golf-modal.lobby.button.send--2"
					>
						{i18n._(joined ? LEAVE_DESCRIPTOR : JOIN_DESCRIPTOR)}
					</Button>
					<Button
						small
						variant="secondary"
						disabled={!joined}
						onClick={() => send({t: 'addBot'})}
						data-flx="voice.golf-modal.lobby.button.send--3"
					>
						{i18n._(ADD_BOT_DESCRIPTOR)}
					</Button>
					<Button
						small
						variant="secondary"
						disabled={!joined || !state.players.some((player) => player.bot)}
						onClick={() => send({t: 'removeBot'})}
						data-flx="voice.golf-modal.lobby.button.send--4"
					>
						{i18n._(REMOVE_BOT_DESCRIPTOR)}
					</Button>
				</div>
			</div>
			{needsOpponent ? (
				<p className={styles.hint} data-flx="voice.golf-modal.lobby.hint">
					{i18n._(NEEDS_OPPONENT_DESCRIPTOR)}
				</p>
			) : null}
			{winner ? (
				<p className={styles.status} data-flx="voice.golf-modal.lobby.status">
					{i18n._(LAST_GAME_DESCRIPTOR, {name: winner})}
				</p>
			) : null}
			<Button
				disabled={!joined || needsOpponent}
				onClick={() => send({t: 'start'})}
				data-flx="voice.golf-modal.lobby.button.send--5"
			>
				{i18n._(START_DESCRIPTOR)}
			</Button>
		</div>
	);
}

function Scoreboard({state}: {state: GolfView}) {
	const {i18n} = useLingui();
	const race = state.mode === 'race';
	return (
		<div className={styles.score} data-flx="voice.golf-modal.scoreboard.score">
			<span className={styles.scoreHead} data-flx="voice.golf-modal.scoreboard.score-head">
				{i18n._(STROKES_DESCRIPTOR)}
			</span>
			<span className={styles.scoreHeadTotal} data-flx="voice.golf-modal.scoreboard.score-head-total">
				{i18n._(race ? POINTS_DESCRIPTOR : TOTAL_DESCRIPTOR)}
			</span>
			{state.players.map((player, index) => (
				<PlayerRow
					key={player.userId ?? player.name}
					player={player}
					index={index}
					race={race}
					data-flx="voice.golf-modal.scoreboard.player-row"
				/>
			))}
		</div>
	);
}

function PlayerRow({player, index, race}: {player: GolfPlayer; index: number; race: boolean}) {
	return (
		<>
			<PlayerName player={player} index={index} data-flx="voice.golf-modal.player-row.player-name" />
			<span
				className={clsx(styles.value, player.done && styles.valueDone)}
				data-flx="voice.golf-modal.player-row.value"
			>
				{player.strokes}
			</span>
			<span className={styles.value} data-flx="voice.golf-modal.player-row.value--2">
				{race ? player.points : player.total}
			</span>
		</>
	);
}

function HoleResult({state}: {state: GolfView}) {
	const {i18n} = useLingui();
	const result = state.holeResult;
	if (!result) return null;
	return (
		<div className={styles.overlay} data-flx="voice.golf-modal.hole-result.overlay">
			<div className={styles.card} data-flx="voice.golf-modal.hole-result.card">
				<span className={styles.cardTitle} data-flx="voice.golf-modal.hole-result.card-title">
					{i18n._(COURSE_DONE_DESCRIPTOR)}
				</span>
				<div className={styles.ranking} data-flx="voice.golf-modal.hole-result.ranking">
					{result.ranking.map((entry, position) => (
						<RankRow
							key={entry.name}
							position={position + 1}
							name={entry.name}
							value={entry.finished ? entry.strokes : i18n._(DID_NOT_FINISH_DESCRIPTOR)}
							data-flx="voice.golf-modal.hole-result.rank-row"
						/>
					))}
				</div>
				{result.eliminated.length > 0 ? (
					<span className={styles.eliminated} data-flx="voice.golf-modal.hole-result.eliminated">
						{i18n._(ELIMINATED_DESCRIPTOR, {names: result.eliminated.join(', ')})}
					</span>
				) : null}
			</div>
		</div>
	);
}

function RankRow({position, name, value}: {position: number; name: string; value: React.ReactNode}) {
	return (
		<>
			<span data-flx="voice.golf-modal.rank-row.span">{position}</span>
			<span className={styles.name} data-flx="voice.golf-modal.rank-row.name">
				{name}
			</span>
			<span className={styles.value} data-flx="voice.golf-modal.rank-row.value">
				{value}
			</span>
		</>
	);
}

function FinalResult({state}: {state: GolfView}) {
	const {i18n} = useLingui();
	const result = state.lastResult;
	if (!result) return null;
	return (
		<div className={styles.overlay} data-flx="voice.golf-modal.final-result.overlay">
			<div className={styles.card} data-flx="voice.golf-modal.final-result.card">
				<span className={styles.cardTitle} data-flx="voice.golf-modal.final-result.card-title">
					{i18n._(WINNER_DESCRIPTOR, {name: result.ranking[0].name})}
				</span>
				<div className={styles.ranking} data-flx="voice.golf-modal.final-result.ranking">
					{result.ranking.map((entry, position) => (
						<RankRow
							key={entry.name}
							position={position + 1}
							name={entry.name}
							value={result.mode === 'race' ? entry.points : entry.total}
							data-flx="voice.golf-modal.final-result.rank-row"
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function Countdown({seconds}: {seconds: number}) {
	const [left, setLeft] = useState(Math.ceil(seconds));
	useEffect(() => {
		const endsAt = performance.now() + seconds * 1000;
		const interval = setInterval(() => setLeft(Math.ceil((endsAt - performance.now()) / 1000)), 100);
		return () => clearInterval(interval);
	}, [seconds]);
	useEffect(() => {
		if (left > 0) golfSounds.play('tick');
	}, [left]);
	if (left <= 0) return null;
	return (
		<div className={styles.overlay} data-flx="voice.golf-modal.countdown.overlay">
			<span key={left} className={styles.countdown} data-flx="voice.golf-modal.countdown.countdown">
				{left}
			</span>
		</div>
	);
}

function Clock({deadline, scene}: {deadline: number; scene: GolfScene | null}) {
	const [left, setLeft] = useState<number | null>(null);
	useEffect(() => {
		const interval = setInterval(() => {
			if (scene) setLeft(Math.max(0, Math.ceil(deadline - scene.time)));
		}, CLOCK_REFRESH_MS);
		return () => clearInterval(interval);
	}, [deadline, scene]);
	if (left === null || left > CLOCK_VISIBLE_SECONDS) return null;
	return (
		<div className={styles.clock} data-flx="voice.golf-modal.clock.clock">
			{left}s
		</div>
	);
}

function Hud({
	state,
	send,
	scene,
	powerRef,
}: {
	state: GolfView;
	send: GameSend;
	scene: GolfScene | null;
	powerRef: React.RefObject<HTMLDivElement | null>;
}) {
	const {i18n} = useLingui();
	const [muted, setMuted] = useState(golfSounds.muted);
	const [overview, setOverview] = useState(false);
	const me = state.you === null ? null : state.players[state.you];
	const index = state.holeIndex + (state.phase === 'countdown' || state.phase === 'hole' ? 1 : 0);
	const progress =
		state.mode === 'tournament'
			? i18n._(COURSE_DESCRIPTOR, {index})
			: i18n._(COURSE_OF_DESCRIPTOR, {index, count: state.holeCount});
	let tip = i18n._(TIP_DESCRIPTOR);
	if (!me) tip = i18n._(WATCHING_DESCRIPTOR);
	else if (me.out) tip = i18n._(YOU_ARE_OUT_DESCRIPTOR);
	return (
		<>
			<div className={styles.top} data-flx="voice.golf-modal.hud.top">
				<div data-flx="voice.golf-modal.hud.div">
					<div className={styles.title} data-flx="voice.golf-modal.hud.title">
						{state.courseName}
					</div>
					<div className={styles.subtitle} data-flx="voice.golf-modal.hud.subtitle">
						{progress}
					</div>
					{state.deadline !== null ? (
						<Clock deadline={state.deadline} scene={scene} data-flx="voice.golf-modal.hud.clock" />
					) : null}
				</div>
				<Scoreboard state={state} data-flx="voice.golf-modal.hud.scoreboard" />
			</div>
			<div className={styles.bottom} data-flx="voice.golf-modal.hud.bottom">
				<div className={styles.power} data-flx="voice.golf-modal.hud.power">
					<div ref={powerRef} className={styles.powerFill} data-flx="voice.golf-modal.hud.power-fill" />
				</div>
				<p className={styles.tip} data-flx="voice.golf-modal.hud.tip">
					{tip}
				</p>
				<div className={styles.controls} data-flx="voice.golf-modal.hud.controls">
					<Button
						small
						variant="secondary"
						onClick={() => setOverview(scene?.toggleOverview() ?? false)}
						data-flx="voice.golf-modal.hud.button.set-overview"
					>
						{i18n._(overview ? SHOW_BALL_DESCRIPTOR : SHOW_COURSE_DESCRIPTOR)}
					</Button>
					<Button
						square
						small
						variant="secondary"
						aria-label={i18n._(muted ? UNMUTE_DESCRIPTOR : MUTE_DESCRIPTOR)}
						icon={
							muted ? (
								<SpeakerSlashIcon data-flx="voice.golf-modal.hud.speaker-slash-icon" />
							) : (
								<SpeakerHighIcon data-flx="voice.golf-modal.hud.speaker-high-icon" />
							)
						}
						onClick={() => {
							golfSounds.muted = !muted;
							setMuted(!muted);
						}}
						data-flx="voice.golf-modal.hud.button.set-muted"
					/>
					<Button
						small
						variant="secondary"
						disabled={!me}
						onClick={() => send({t: 'stop'})}
						data-flx="voice.golf-modal.hud.button.send"
					>
						{i18n._(END_GAME_DESCRIPTOR)}
					</Button>
				</div>
			</div>
		</>
	);
}

const GolfModal: React.FC = observer(() => {
	const {i18n} = useLingui();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const powerRef = useRef<HTMLDivElement>(null);
	const sceneRef = useRef<GolfScene | null>(null);
	const queuedRef = useRef<Array<{t: string; course?: GolfCourse} & Partial<GolfFrame>>>([]);
	const previousRef = useRef<GolfView | null>(null);
	const [scene, setScene] = useState<GolfScene | null>(null);
	const [no3d, setNo3d] = useState(false);

	const deliver = useCallback((message: {t: string; course?: GolfCourse} & Partial<GolfFrame>) => {
		const target = sceneRef.current;
		if (!target) {
			if (message.t === 'course') queuedRef.current = [];
			queuedRef.current.push(message);
			return;
		}
		if (message.t === 'course' && message.course) target.setCourse(message.course);
		if (message.t === 'frame') target.addFrame(message as GolfFrame);
	}, []);

	const {state, status, send} = useVoiceGameSocket<GolfView>(SOCKET_PATH, deliver);
	const inGame = Boolean(state && state.phase !== 'lobby');

	useEffect(() => {
		if (!inGame || sceneRef.current) return;
		let cancelled = false;
		void import('@app/features/voice/components/GolfScene').then(({GolfScene: Scene}) => {
			const canvas = canvasRef.current;
			if (cancelled || !canvas || sceneRef.current) return;
			try {
				const created = new Scene(
					canvas,
					(shot) => send({t: 'shot', ...shot}),
					(power) => {
						if (powerRef.current) powerRef.current.style.transform = `scaleX(${power})`;
					},
				);
				sceneRef.current = created;
				for (const message of queuedRef.current.splice(0)) deliver(message);
				setScene(created);
			} catch {
				setNo3d(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [deliver, inGame, send]);

	useEffect(
		() => () => {
			sceneRef.current?.dispose();
			sceneRef.current = null;
		},
		[],
	);

	useEffect(() => {
		if (state && scene) scene.setPlayers(state.players, state.you, state.phase === 'hole');
	}, [scene, state]);

	useEffect(() => {
		if (!state) return;
		for (const sound of golfPhaseSounds(previousRef.current, state)) golfSounds.play(sound);
		previousRef.current = state;
	}, [state]);

	let notice: string | null = null;
	if (status === 'unavailable') notice = i18n._(UNAVAILABLE_DESCRIPTOR);
	else if (no3d) notice = i18n._(NO_3D_DESCRIPTOR);
	return (
		<Modal.Root size="xlarge" centered data-flx="voice.golf-modal.modal-root">
			<Modal.Header
				title={i18n._(TITLE_DESCRIPTOR)}
				onClose={ModalCommands.pop}
				data-flx="voice.golf-modal.modal-header"
			/>
			<Modal.Content padding="none" data-flx="voice.golf-modal.modal-content">
				<div className={styles.stage} data-flx="voice.golf-modal.stage">
					<canvas
						ref={canvasRef}
						className={clsx(styles.canvas, !inGame && styles.hidden)}
						data-flx="voice.golf-modal.canvas"
					/>
					{state && inGame ? (
						<Hud state={state} send={send} scene={scene} powerRef={powerRef} data-flx="voice.golf-modal.hud" />
					) : null}
					{state?.phase === 'countdown' ? (
						<Countdown seconds={state.timer} data-flx="voice.golf-modal.countdown" />
					) : null}
					{state?.phase === 'holeEnd' ? <HoleResult state={state} data-flx="voice.golf-modal.hole-result" /> : null}
					{state?.phase === 'results' ? <FinalResult state={state} data-flx="voice.golf-modal.final-result" /> : null}
					{state?.phase === 'lobby' ? <Lobby state={state} send={send} data-flx="voice.golf-modal.lobby" /> : null}
					{!state && !notice ? (
						<div className={styles.overlay} data-flx="voice.golf-modal.overlay">
							<Spinner data-flx="voice.golf-modal.spinner" />
						</div>
					) : null}
					{notice || status === 'lost' ? (
						<div className={styles.overlay} data-flx="voice.golf-modal.overlay--2">
							<p className={styles.card} data-flx="voice.golf-modal.card">
								{notice ?? i18n._(CONNECTION_LOST_DESCRIPTOR)}
							</p>
						</div>
					) : null}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
});

GolfModal.displayName = 'GolfModal';

export function openGolfModal(): void {
	ModalCommands.push(ModalCommands.modal(() => <GolfModal data-flx="voice.golf-modal.open-golf-modal.golf-modal" />));
}
