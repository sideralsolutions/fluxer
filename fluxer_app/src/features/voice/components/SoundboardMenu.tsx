// SPDX-License-Identifier: AGPL-3.0-or-later

import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {MenuItemSlider} from '@app/features/ui/action_menu/MenuItemSlider';
import Users from '@app/features/user/state/Users';
import * as NicknameUtils from '@app/features/user/utils/NicknameUtils';
import {openSoundSearchModal} from '@app/features/voice/components/SoundSearchModal';
import {openVoiceVideoSettings} from '@app/features/voice/components/VoiceSettingsMenus';
import MediaEngine from '@app/features/voice/engine/MediaEngineFacade';
import Soundboard from '@app/features/voice/engine/Soundboard';
import EntranceSoundLibrary from '@app/features/voice/state/EntranceSoundLibrary';
import EntranceSoundListenerPrefs from '@app/features/voice/state/EntranceSoundListenerPrefs';
import {VOICE_VOLUME_MAX_PERCENT} from '@app/features/voice/utils/VoiceVolumeUtils';
import {ME} from '@fluxer/constants/src/AppConstants';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {GearIcon, MagnifyingGlassIcon, PlayIcon, StopIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect} from 'react';

export const SOUNDBOARD_DESCRIPTOR = msg({
	message: 'Soundboard',
	comment: 'Label of the voice call button that opens the soundboard menu with the sounds you can play to the call.',
});
const SEARCH_SOUNDS_DESCRIPTOR = msg({
	message: 'Search sounds',
	comment: 'Soundboard menu item that opens the search for new sounds to favorite.',
});
const MANAGE_SOUNDS_DESCRIPTOR = msg({
	message: 'Manage sounds',
	comment: 'Soundboard menu item that opens voice settings, where sounds are uploaded.',
});
const LOADING_SOUNDS_DESCRIPTOR = msg({
	message: 'Loading sounds…',
	comment: 'Disabled soundboard menu item shown while the sound library loads.',
});
const NO_SOUNDS_DESCRIPTOR = msg({
	message: 'No sounds yet',
	comment: 'Disabled soundboard menu item shown when the user has not uploaded any sound.',
});
const STOP_SOUNDS_DESCRIPTOR = msg({
	message: 'Stop sounds',
	comment: "Soundboard menu item that stops every sound playing for you, and the user's own sounds for everyone.",
});
const MY_SOUNDS_VOLUME_DESCRIPTOR = msg({
	message: 'My sounds',
	comment: "Soundboard menu slider label for the local volume of the user's own sounds.",
});
const SOUNDBOARD_UNAVAILABLE_DESCRIPTOR = msg({
	message: 'Not available in peer-to-peer calls',
	comment: 'Hint on soundboard sounds when the current voice call is peer-to-peer and cannot carry soundboard plays.',
});

interface SoundboardMenuProps {
	onClose: () => void;
}

const SoundVolumeSlider: React.FC<{userId: string; label: string}> = observer(({userId, label}) => (
	<MenuItemSlider
		label={label}
		value={EntranceSoundListenerPrefs.getVolume(userId)}
		maxValue={VOICE_VOLUME_MAX_PERCENT}
		onChange={(value) => EntranceSoundListenerPrefs.setVolume(userId, value)}
		data-flx="voice.soundboard-menu.volume-slider"
	/>
));

export const SoundboardMenu: React.FC<SoundboardMenuProps> = observer(({onClose}) => {
	const {i18n} = useLingui();
	useEffect(() => {
		void EntranceSoundLibrary.load();
	}, []);
	const sounds = EntranceSoundLibrary.list;
	const available = Soundboard.available;
	const placeholder = EntranceSoundLibrary.loaded ? NO_SOUNDS_DESCRIPTOR : LOADING_SOUNDS_DESCRIPTOR;
	const {guildId, channelId} = MediaEngine;
	const currentUserId = Users.getCurrentUser()?.id;
	const voiceStates = channelId ? MediaEngine.getAllVoiceStatesInChannel(guildId ?? ME, channelId) : {};
	const otherUsers = [...new Set(Object.values(voiceStates).map((state) => state.user_id))]
		.filter((userId) => userId !== currentUserId)
		.flatMap((userId) => Users.getUser(userId) ?? []);
	return (
		<>
			<MenuGroup data-flx="voice.soundboard-menu.menu-group">
				{EntranceSoundLibrary.loaded && sounds.length > 0 ? (
					sounds.map((sound) => (
						<MenuItem
							key={sound.id}
							icon={<PlayIcon weight="fill" data-flx="voice.soundboard-menu.menu-item.sound.icon" />}
							disabled={!available}
							hint={available ? undefined : i18n._(SOUNDBOARD_UNAVAILABLE_DESCRIPTOR)}
							closeOnSelect={false}
							onClick={() => void Soundboard.play(sound)}
							data-flx="voice.soundboard-menu.menu-item.sound"
						>
							{sound.name}
						</MenuItem>
					))
				) : (
					<MenuItem disabled data-flx="voice.soundboard-menu.menu-item.placeholder">
						{i18n._(placeholder)}
					</MenuItem>
				)}
				<MenuItem
					icon={<StopIcon weight="fill" data-flx="voice.soundboard-menu.menu-item.stop.icon" />}
					disabled={!available}
					closeOnSelect={false}
					onClick={() => void Soundboard.stop()}
					data-flx="voice.soundboard-menu.menu-item.stop"
				>
					{i18n._(STOP_SOUNDS_DESCRIPTOR)}
				</MenuItem>
			</MenuGroup>
			<MenuGroup data-flx="voice.soundboard-menu.menu-group--volume">
				{currentUserId && (
					<SoundVolumeSlider
						userId={currentUserId}
						label={i18n._(MY_SOUNDS_VOLUME_DESCRIPTOR)}
						data-flx="voice.soundboard-menu.sound-volume-slider"
					/>
				)}
				{otherUsers.map((user) => (
					<SoundVolumeSlider
						key={user.id}
						userId={user.id}
						label={NicknameUtils.getNickname(user, guildId, channelId ?? undefined)}
						data-flx="voice.soundboard-menu.sound-volume-slider--2"
					/>
				))}
			</MenuGroup>
			<MenuGroup data-flx="voice.soundboard-menu.menu-group--2">
				<MenuItem
					icon={<MagnifyingGlassIcon weight="bold" data-flx="voice.soundboard-menu.menu-item.search.icon" />}
					onClick={() => openSoundSearchModal(onClose)}
					data-flx="voice.soundboard-menu.menu-item.search"
				>
					{i18n._(SEARCH_SOUNDS_DESCRIPTOR)}
				</MenuItem>
				<MenuItem
					icon={<GearIcon weight="fill" data-flx="voice.soundboard-menu.menu-item.manage.icon" />}
					onClick={() => openVoiceVideoSettings(onClose, 'audio')}
					data-flx="voice.soundboard-menu.menu-item.manage"
				>
					{i18n._(MANAGE_SOUNDS_DESCRIPTOR)}
				</MenuItem>
			</MenuGroup>
		</>
	);
});
