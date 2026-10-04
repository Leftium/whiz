import { writeExecutionSettings } from '#lib/bang-data.js';
import {
	defaultExecutionSettings,
	isBangProvider,
	isSearchProvider,
	type ExecutionSettings,
	type SearchProvider
} from '#lib/execution-settings.js';
import { readHistoryRecordingEnabled, writeHistoryRecordingEnabled } from '#lib/search-history.js';

import type { BangProviderId } from '#lib/bang-data.js';

export type { ExecutionSettings, SearchProvider } from '#lib/execution-settings.js';

export type ColorScheme = '' | 'dark' | 'light';

export const settings = $state({
	colorScheme: '' as ColorScheme,
	historyRecordingEnabled: true,
	...defaultExecutionSettings
});

function applyColorScheme(colorScheme: ColorScheme) {
	settings.colorScheme = colorScheme;

	if (!colorScheme) {
		document.documentElement.removeAttribute('data-theme');
		document.documentElement.style.removeProperty('color-scheme');
		localStorage.removeItem('theme');
		return;
	}

	document.documentElement.dataset.theme = colorScheme;
	document.documentElement.style.colorScheme = colorScheme;
	localStorage.setItem('theme', colorScheme);
}

export function setColorScheme(colorScheme: ColorScheme) {
	applyColorScheme(colorScheme);
}

export function setSearchProvider(searchProvider: SearchProvider) {
	settings.searchProvider = searchProvider;
	localStorage.setItem('searchProvider', searchProvider);
	mirrorExecutionSettings();
}

export function setCustomSearchTarget(label: string, template: string) {
	settings.customSearchLabel = label;
	settings.customSearchTemplate = template;
	settings.searchProvider = 'custom';
	localStorage.setItem('customSearchLabel', label);
	localStorage.setItem('customSearchTemplate', template);
	localStorage.setItem('searchProvider', 'custom');
	mirrorExecutionSettings();
}

export function setBangProvider(bangProvider: BangProviderId) {
	settings.bangProvider = bangProvider;
	localStorage.setItem('bangProvider', bangProvider);
	mirrorExecutionSettings();
}

export function setHistoryRecordingEnabled(enabled: boolean) {
	settings.historyRecordingEnabled = enabled;
	localStorage.setItem('historyRecordingEnabled', enabled ? 'true' : 'false');
	mirrorHistoryRecordingEnabled();
}

export function initSettings() {
	const storedColorScheme = localStorage.getItem('theme');
	const storedBangProvider = localStorage.getItem('bangProvider');
	const storedSearchProvider = localStorage.getItem('searchProvider');
	const storedCustomSearchLabel = localStorage.getItem('customSearchLabel');
	const storedCustomSearchTemplate = localStorage.getItem('customSearchTemplate');
	const storedHistoryRecordingEnabled = localStorage.getItem('historyRecordingEnabled');

	if (storedColorScheme === 'dark' || storedColorScheme === 'light') {
		applyColorScheme(storedColorScheme);
	}

	if (isSearchProvider(storedSearchProvider)) {
		settings.searchProvider = storedSearchProvider;
	}

	if (storedCustomSearchLabel) settings.customSearchLabel = storedCustomSearchLabel;
	if (storedCustomSearchTemplate?.includes('%s')) {
		settings.customSearchTemplate = storedCustomSearchTemplate;
	}

	if (isBangProvider(storedBangProvider)) {
		settings.bangProvider = storedBangProvider;
	}

	if (storedHistoryRecordingEnabled === 'true' || storedHistoryRecordingEnabled === 'false') {
		settings.historyRecordingEnabled = storedHistoryRecordingEnabled === 'true';
		mirrorHistoryRecordingEnabled();
	} else {
		void readHistoryRecordingEnabled()
			.then((enabled) => {
				settings.historyRecordingEnabled = enabled;
				localStorage.setItem('historyRecordingEnabled', enabled ? 'true' : 'false');
			})
			.catch((error) => console.warn('Failed to read history recording setting', error));
	}

	mirrorExecutionSettings();
}

export function readStoredExecutionSettings(): ExecutionSettings {
	const fallback = {
		bangProvider: settings.bangProvider,
		searchProvider: settings.searchProvider,
		customSearchLabel: settings.customSearchLabel,
		customSearchTemplate: settings.customSearchTemplate
	};

	if (typeof localStorage === 'undefined') {
		return fallback;
	}

	try {
		const storedBangProvider = localStorage.getItem('bangProvider');
		const storedSearchProvider = localStorage.getItem('searchProvider');
		const storedCustomSearchLabel = localStorage.getItem('customSearchLabel');
		const storedCustomSearchTemplate = localStorage.getItem('customSearchTemplate');

		return {
			bangProvider: isBangProvider(storedBangProvider) ? storedBangProvider : fallback.bangProvider,
			searchProvider: isSearchProvider(storedSearchProvider)
				? storedSearchProvider
				: fallback.searchProvider,
			customSearchLabel: storedCustomSearchLabel || fallback.customSearchLabel,
			customSearchTemplate: storedCustomSearchTemplate?.includes('%s')
				? storedCustomSearchTemplate
				: fallback.customSearchTemplate
		};
	} catch {
		return fallback;
	}
}

function mirrorExecutionSettings() {
	void writeExecutionSettings({
		bangProvider: settings.bangProvider,
		searchProvider: settings.searchProvider,
		customSearchLabel: settings.customSearchLabel,
		customSearchTemplate: settings.customSearchTemplate
	}).catch((error) => console.warn('Failed to mirror execution settings', error));
}

function mirrorHistoryRecordingEnabled() {
	void writeHistoryRecordingEnabled(settings.historyRecordingEnabled).catch((error) =>
		console.warn('Failed to mirror history recording setting', error)
	);
}
