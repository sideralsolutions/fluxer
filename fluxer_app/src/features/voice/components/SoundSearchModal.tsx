// SPDX-License-Identifier: AGPL-3.0-or-later

import * as Modal from '@app/features/app/components/dialogs/Modal';
import {wrapDesktopLocalResourceURL} from '@app/features/messaging/utils/DesktopResourceUrl';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {readBlobAsBase64NoPrefix} from '@app/features/platform/utils/BlobDataUrl';
import {Button} from '@app/features/ui/button/Button';
import * as ModalCommands from '@app/features/ui/commands/ModalCommands';
import * as ToastCommands from '@app/features/ui/commands/ToastCommands';
import {Input} from '@app/features/ui/components/form/FormInput';
import {Spinner} from '@app/features/ui/components/Spinner';
import {openEntranceSoundTrimmerModal} from '@app/features/voice/components/EntranceSoundTrimmerModal';
import styles from '@app/features/voice/components/SoundSearchModal.module.css';
import EntranceSoundPlaybackEngine from '@app/features/voice/engine/EntranceSoundPlaybackEngine';
import EntranceSoundLibrary from '@app/features/voice/state/EntranceSoundLibrary';
import {type MyInstantsSound, searchMyInstants} from '@app/features/voice/utils/MyInstants';
import {ENTRANCE_SOUND_MAX_BYTES, ENTRANCE_SOUND_MAX_DURATION_MS} from '@fluxer/constants/src/EntranceSoundConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {MagnifyingGlassIcon, PlayIcon, StarIcon, StopIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect, useRef, useState} from 'react';

const logger = new Logger('SoundSearchModal');

const SEARCH_DEBOUNCE_MS = 350;

const TITLE_DESCRIPTOR = msg({
	message: 'Search sounds',
	comment: 'Soundboard menu item that opens the search for new sounds to favorite.',
});
const PLACEHOLDER_DESCRIPTOR = msg({
	message: 'Search Myinstants…',
	comment: 'Placeholder of the soundboard sound search field. Myinstants is a website name.',
});
const SOURCE_DESCRIPTOR = msg({
	message: 'Sounds from myinstants.com. Favorite one to add it to your soundboard.',
	comment: 'Hint at the top of the soundboard sound search.',
});
const NO_RESULTS_DESCRIPTOR = msg({
	message: 'No sounds found',
	comment: 'Shown when the soundboard sound search has no results.',
});
const SEARCH_FAILED_DESCRIPTOR = msg({
	message: "Couldn't search sounds. Try again in a moment.",
	comment: 'Shown when the soundboard sound search request fails.',
});
const LOAD_MORE_DESCRIPTOR = msg({
	message: 'Load more',
	comment: 'Button that loads the next page of soundboard search results.',
});
const PREVIEW_DESCRIPTOR = msg({
	message: 'Preview sound',
	comment: 'Accessible label of the button that plays a soundboard search result only for you.',
});
const FAVORITE_DESCRIPTOR = msg({
	message: 'Favorite sound',
	comment: 'Accessible label of the button that adds a search result to the soundboard, or removes it again.',
});
const FAVORITE_FAILED_DESCRIPTOR = msg({
	message: "Couldn't change this favorite. Try again in a moment.",
	comment: 'Toast when adding a sound to the soundboard, or removing it, fails.',
});
const LIBRARY_FULL_DESCRIPTOR = msg({
	message: 'Your sound library is full. Remove a sound first.',
	comment: 'Toast when favoriting a sound while the sound library has no free slot.',
});

function bufferKey(sound: MyInstantsSound): string {
	return `myinstants:${sound.slug}`;
}

async function favoriteSound(sound: MyInstantsSound): Promise<void> {
	const [buffer, response] = await Promise.all([
		EntranceSoundPlaybackEngine.fetchBuffer(sound.url, bufferKey(sound)),
		fetch(wrapDesktopLocalResourceURL(sound.url), {cache: 'force-cache'}),
	]);
	if (!buffer || !response.ok) throw new Error('Could not load sound');
	const blob = await response.blob();
	const upload = async (audio: Blob) => {
		await EntranceSoundLibrary.uploadSound({
			name: sound.name,
			base64Audio: await readBlobAsBase64NoPrefix(audio),
		});
	};
	if (buffer.duration * 1000 > ENTRANCE_SOUND_MAX_DURATION_MS || blob.size > ENTRANCE_SOUND_MAX_BYTES) {
		openEntranceSoundTrimmerModal({
			sourceFile: new File([blob], `${sound.name}.mp3`, {type: blob.type}),
			onConfirm: (trimmed) => upload(trimmed.blob),
		});
		return;
	}
	await upload(blob);
}

const SoundSearchModal: React.FC = observer(() => {
	const {i18n} = useLingui();
	const [query, setQuery] = useState('');
	const [page, setPage] = useState(1);
	const [sounds, setSounds] = useState<Array<MyInstantsSound>>([]);
	const [hasMore, setHasMore] = useState(false);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [previewing, setPreviewing] = useState<string | null>(null);
	const [saving, setSaving] = useState<string | null>(null);
	const previewRef = useRef<string | null>(null);

	useEffect(() => {
		void EntranceSoundLibrary.load();
		return () => {
			previewRef.current = null;
			EntranceSoundPlaybackEngine.stopPreview();
		};
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setFailed(false);
		const timer = setTimeout(
			() => {
				searchMyInstants(query, page, controller.signal)
					.then((result) => {
						setSounds((current) => {
							if (page === 1) return result.sounds;
							const known = new Set(current.map((sound) => sound.slug));
							return [...current, ...result.sounds.filter((sound) => !known.has(sound.slug))];
						});
						setHasMore(result.hasMore);
						setLoading(false);
					})
					.catch((error) => {
						if (controller.signal.aborted) return;
						logger.warn('Sound search failed', {error});
						setFailed(true);
						setLoading(false);
					});
			},
			page === 1 ? SEARCH_DEBOUNCE_MS : 0,
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query, page]);

	const togglePreview = async (sound: MyInstantsSound) => {
		EntranceSoundPlaybackEngine.stopPreview();
		const next = previewRef.current === sound.slug ? null : sound.slug;
		previewRef.current = next;
		setPreviewing(next);
		if (!next) return;
		const buffer = await EntranceSoundPlaybackEngine.fetchBuffer(sound.url, bufferKey(sound));
		if (previewRef.current !== next) return;
		const finish = () => {
			if (previewRef.current !== next) return;
			previewRef.current = null;
			setPreviewing(null);
		};
		if (buffer) {
			EntranceSoundPlaybackEngine.playPreview(buffer, finish);
		} else {
			finish();
		}
	};

	const toggleFavorite = async (sound: MyInstantsSound) => {
		const favorite = EntranceSoundLibrary.list.find((entry) => entry.name === sound.name);
		if (!favorite && EntranceSoundLibrary.libraryFull) {
			ToastCommands.createToast({type: 'error', children: i18n._(LIBRARY_FULL_DESCRIPTOR)});
			return;
		}
		setSaving(sound.slug);
		try {
			if (favorite) {
				await EntranceSoundLibrary.deleteSound(favorite.id);
			} else {
				await favoriteSound(sound);
			}
		} catch (error) {
			logger.warn('Failed to change favorite sound', {error});
			ToastCommands.createToast({type: 'error', children: i18n._(FAVORITE_FAILED_DESCRIPTOR)});
		} finally {
			setSaving(null);
		}
	};

	let status: React.ReactNode = null;
	if (failed) {
		status = (
			<p className={styles.hint} data-flx="voice.sound-search-modal.hint">
				{i18n._(SEARCH_FAILED_DESCRIPTOR)}
			</p>
		);
	} else if (loading) {
		status = (
			<div className={styles.center} data-flx="voice.sound-search-modal.center">
				<Spinner data-flx="voice.sound-search-modal.spinner" />
			</div>
		);
	} else if (sounds.length === 0) {
		status = (
			<p className={styles.hint} data-flx="voice.sound-search-modal.hint--2">
				{i18n._(NO_RESULTS_DESCRIPTOR)}
			</p>
		);
	}

	return (
		<Modal.Root size="small" centered data-flx="voice.sound-search-modal.modal-root">
			<Modal.Header
				title={i18n._(TITLE_DESCRIPTOR)}
				onClose={ModalCommands.pop}
				data-flx="voice.sound-search-modal.modal-header"
			/>
			<Modal.Content padding="default" data-flx="voice.sound-search-modal.modal-content">
				<div className={styles.body} data-flx="voice.sound-search-modal.body">
					<p className={styles.hint} data-flx="voice.sound-search-modal.hint--3">
						{i18n._(SOURCE_DESCRIPTOR)}
					</p>
					<Input
						autoFocus
						value={query}
						placeholder={i18n._(PLACEHOLDER_DESCRIPTOR)}
						leftIcon={<MagnifyingGlassIcon weight="bold" data-flx="voice.sound-search-modal.magnifying-glass-icon" />}
						onChange={(event) => {
							setQuery(event.target.value);
							setPage(1);
						}}
						data-flx="voice.sound-search-modal.input.set-query"
					/>
					<div className={styles.list} data-flx="voice.sound-search-modal.list">
						{sounds.map((sound) => {
							const isPreviewing = previewing === sound.slug;
							const isFavorite = EntranceSoundLibrary.list.some((entry) => entry.name === sound.name);
							return (
								<div key={sound.slug} className={styles.row} data-flx="voice.sound-search-modal.row">
									<Button
										square
										small
										variant="secondary"
										aria-label={i18n._(PREVIEW_DESCRIPTOR)}
										icon={
											isPreviewing ? (
												<StopIcon weight="fill" data-flx="voice.sound-search-modal.stop-icon" />
											) : (
												<PlayIcon weight="fill" data-flx="voice.sound-search-modal.play-icon" />
											)
										}
										onClick={() => void togglePreview(sound)}
										data-flx="voice.sound-search-modal.button"
									/>
									<span className={styles.name} title={sound.name} data-flx="voice.sound-search-modal.name">
										{sound.name}
									</span>
									<Button
										square
										small
										variant="secondary"
										aria-label={i18n._(FAVORITE_DESCRIPTOR)}
										aria-pressed={isFavorite}
										submitting={saving === sound.slug}
										icon={
											<StarIcon
												weight={isFavorite ? 'fill' : 'regular'}
												data-flx="voice.sound-search-modal.star-icon"
											/>
										}
										onClick={() => void toggleFavorite(sound)}
										data-flx="voice.sound-search-modal.button--2"
									/>
								</div>
							);
						})}
					</div>
					{status}
					{hasMore && !loading && !failed ? (
						<Button
							variant="secondary"
							small
							onClick={() => setPage((current) => current + 1)}
							data-flx="voice.sound-search-modal.button.set-page"
						>
							{i18n._(LOAD_MORE_DESCRIPTOR)}
						</Button>
					) : null}
				</div>
			</Modal.Content>
		</Modal.Root>
	);
});

SoundSearchModal.displayName = 'SoundSearchModal';

export function openSoundSearchModal(onClose: () => void): void {
	ModalCommands.pushAfterBottomSheetClose(
		onClose,
		ModalCommands.modal(() => (
			<SoundSearchModal data-flx="voice.sound-search-modal.open-sound-search-modal.sound-search-modal" />
		)),
	);
}
