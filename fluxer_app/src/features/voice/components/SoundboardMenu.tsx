// SPDX-License-Identifier: AGPL-3.0-or-later

import {MenuGroup} from '@app/features/ui/action_menu/MenuGroup';
import {MenuItem} from '@app/features/ui/action_menu/MenuItem';
import {openVoiceVideoSettings} from '@app/features/voice/components/VoiceSettingsMenus';
import Soundboard from '@app/features/voice/engine/Soundboard';
import EntranceSoundLibrary from '@app/features/voice/state/EntranceSoundLibrary';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import {GearIcon, PlayIcon} from '@phosphor-icons/react';
import {observer} from 'mobx-react-lite';
import type React from 'react';
import {useEffect} from 'react';

export const SOUNDBOARD_DESCRIPTOR = msg({
	message: 'Soundboard',
	comment: 'Label of the voice call button that opens the soundboard menu with the sounds you can play to the call.',
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
const SOUNDBOARD_UNAVAILABLE_DESCRIPTOR = msg({
	message: 'Not available in peer-to-peer calls',
	comment: 'Hint on soundboard sounds when the current voice call is peer-to-peer and cannot carry soundboard plays.',
});

interface SoundboardMenuProps {
	onClose: () => void;
}

export const SoundboardMenu: React.FC<SoundboardMenuProps> = observer(({onClose}) => {
	const {i18n} = useLingui();
	useEffect(() => {
		void EntranceSoundLibrary.load();
	}, []);
	const sounds = EntranceSoundLibrary.list;
	const available = Soundboard.available;
	const placeholder = EntranceSoundLibrary.loaded ? NO_SOUNDS_DESCRIPTOR : LOADING_SOUNDS_DESCRIPTOR;
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
			</MenuGroup>
			<MenuGroup data-flx="voice.soundboard-menu.menu-group--2">
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
