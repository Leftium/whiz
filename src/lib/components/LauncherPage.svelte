<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import fuzzysort from 'fuzzysort';
	import { onMount, tick } from 'svelte';

	import {
		createMyBangId,
		readMyBangs,
		writeMyBangs,
		type BangProviderId,
		type MyBangRecord,
		type RankedZbangCatalog,
		type ZbangRecord
	} from '#lib/bang-data.js';
	import {
		applyBang,
		filterBangs,
		prepareBangs,
		type BangFilterResult,
		type BangHighlightSegment
	} from '#lib/bang-filter.js';
	import ExpandingTextarea from '#lib/components/ExpandingTextarea.svelte';
	import Header from '#lib/components/Header.svelte';
	import JournalEntryEditor, {
		type JournalEntryEditorSave,
		type JournalEntryEditorSession
	} from '#lib/components/JournalEntryEditor.svelte';
	import MyBangEditor, {
		type MyBangEditorSave,
		type MyBangEditorSession
	} from '#lib/components/MyBangEditor.svelte';
	import {
		createJournalEntry,
		deleteJournalEntry,
		getJournalEntryExcerpt,
		getJournalEntryTitle,
		getLocalJournalDate,
		listJournalEntries,
		updateJournalEntry,
		type JournalEntry
	} from '#lib/journal.js';
	import {
		buildJournalSummaryGroups,
		type JournalSummaryGroup,
		type JournalSummarySignal
	} from '#lib/journal-summary.js';
	import {
		displayBangCode,
		formatBangCodes,
		getBangCodeSet,
		hasBangCodeOverlap,
		normalizeBangCode,
		removeBangCodeOverlaps
	} from '#lib/launcher/bang-code.js';
	import { createBangCodeMap, parseBangComposition } from '#lib/launcher/bang-composition.js';
	import {
		getSearchUrl,
		resolveBangExecutionWithExtendedFallback
	} from '#lib/launcher/bang-resolver.js';
	import { getCompromiseSignals, unique } from '#lib/launcher/compromise-signals.js';
	import { getLauncherMode, launcherModes } from '#lib/launcher/modes.js';
	import {
		createSharedMyBangHash,
		readSharedMyBangHash,
		removeSharedMyBangHash,
		type SharedMyBangDraft
	} from '#lib/launcher/mybang-share.js';
	import { getKeywordScoreBoost, rankItems, scoreInsight } from '#lib/launcher/ranking.js';
	import {
		createBangSearchHistoryEvent,
		createPlainSearchHistoryEvent,
		deleteSearchHistoryEvent,
		getSearchProviderLabel,
		listSearchHistoryEvents,
		recordSearchHistoryEvent,
		type SearchHistoryEvent
	} from '#lib/search-history.js';
	import type {
		BangComposition,
		BangEntry,
		CompromiseSignals,
		LauncherContext,
		LauncherGroup,
		LauncherHref,
		LauncherItem,
		LauncherItemAction,
		LauncherMenuInfo,
		LauncherMode,
		LauncherModeId,
		LauncherPlugin
	} from '#lib/launcher/types.js';
	import {
		setBangProvider,
		setColorScheme,
		setCustomSearchTarget,
		setHistoryRecordingEnabled,
		setSearchProvider,
		settings,
		type ColorScheme,
		type ExecutionSettings,
		type SearchProvider
	} from '#lib/settings.svelte.js';
	import { loadShippedBangCatalog } from '#lib/shipped-bang-catalog.js';

	const stagedBangQueryParam = 'bq';
	const stagedShortcutSequenceParam = 'sk';
	const initialUrlLauncherState = readUrlLauncherState(page.url.searchParams);

	let {
		modeId = 'everything',
		value = $bindable(initialUrlLauncherState.value)
	}: { modeId?: LauncherModeId; value?: string } = $props();

	const searchProviderLabels: Record<SearchProvider, string> = {
		kagi: 'Kagi',
		duckduckgo: 'DuckDuckGo',
		google: 'Google',
		get custom() {
			return settings.customSearchLabel;
		}
	};
	const colorSchemeLabels: Record<ColorScheme, string> = {
		'': 'Auto (System)',
		dark: 'Dark',
		light: 'Light'
	};
	const bangProviderLabels: Record<BangProviderId, string> = {
		kagi: 'Kagi',
		duckduckgo: 'DuckDuckGo'
	};
	const searchProviders = Object.keys(searchProviderLabels) as SearchProvider[];
	const colorSchemes = Object.keys(colorSchemeLabels) as ColorScheme[];
	const bangProviders = Object.keys(bangProviderLabels) as BangProviderId[];
	const historyRecordingLabels = {
		on: 'On',
		off: 'Off the record'
	} as const;
	const itemShortcutLabels = ['Q', 'W', 'E', 'R', 'T', 'Y'] as const;
	const groupShortcutLabels = ['O', 'I', 'P'] as const;
	const menuSlideDuration = 720;
	const shortcutBadgeFlyDuration = 640;
	const pseudoMenuBadgeDelay = 320;
	const pseudoMenuBadgeDuration = 280;
	const shortcutScrollPadding = 12;
	const shortcutScrollBottomPadding = 18;
	const stagedShortcutUrlRetryDelayMs = 50;
	const stagedShortcutUrlRetryLimit = 40;
	const parentShortcutLabel = 'U';
	const utilityShortcutLabels = ['Z', 'X', 'C', 'V'] as const;
	const shortcutKeys = new Set([
		'.',
		' ',
		parentShortcutLabel,
		...utilityShortcutLabels,
		...itemShortcutLabels,
		...groupShortcutLabels
	]);
	const shortcutDelay = 250;
	const settingsMatchThreshold = 0.4;
	const historyMatchThreshold = 0.35;
	const historyGroupCollapsedLimit = 8;
	const journalMatchThreshold = 0.32;
	const journalSummaryCollapsedLimit = 5;
	const launcherGroupItemLimitOptions = [5, 8, 20, 50] as const;
	const countFormatter = new Intl.NumberFormat();
	const bangFanoutAckTimeoutMs = 2500;
	const tokenCounterUrl = 'https://hcodx.com/tools/gpt-4o-token-counter';
	const tokenCounterMaxUrlLength = 6000;
	const aiBangCodes = new Set([
		'!ai',
		'!aichat',
		'!answer',
		'!as',
		'!assistant',
		'!asst',
		'!cgpt',
		'!chat',
		'!chatgpt',
		'!claude',
		'!copilot',
		'!discuss',
		'!duckai',
		'!fast',
		'!fgpt',
		'!gemini',
		'!grok',
		'!llm',
		'!mistral',
		'!perplexity',
		'!phind',
		'!poe'
	]);
	const aiBangPattern =
		/\b(?:anthropic|chatgpt|claude|copilot|fastgpt|gemini|grok|llama|llm|mistral|openai|perplexity|phind)\b|duck\.?ai|kagi assistant/i;
	const launcherGroupItemLimits: Record<string, number> = {
		'bangs.my': 8,
		'bangs.popular': 8,
		'bangs.extended': 8
	};
	type UrlLauncherState = {
		key: string;
		value: string;
		bangEntry?: BangEntry;
		shortcutSequence: string;
	};
	type InputFrame = { data: string | null; inputType: string; ts: number };
	type KeyFrame = { key: string; ts: number };
	type SettingOption = {
		id: string;
		label: string;
		description: string | (() => string);
		aliases: readonly string[];
		selected?: () => boolean;
		run: () => void;
	};
	type LauncherRunnableAction = LauncherItemAction & { kind: 'action' };
	type LauncherInfoAction = LauncherMenuInfo & { kind: 'info' };
	type LauncherAction = LauncherRunnableAction | LauncherInfoAction;
	type PrimaryLauncherTarget =
		| {
				id: string;
				kind: 'item';
				title: string;
				item: LauncherItem;
				groupId?: string;
				actions: LauncherAction[];
		  }
		| { id: string; kind: 'group'; title: string; group: LauncherGroup; actions: LauncherAction[] };
	type ShortcutLane =
		'item-focus' | 'item-menu' | 'group-focus' | 'group-menu' | 'parent' | 'primary' | 'utility';
	type PendingTripleShortcut = {
		key: string;
		ts: number;
		lane: ShortcutLane;
		target?: PrimaryLauncherTarget;
	};
	type ItemShortcutLabel = (typeof itemShortcutLabels)[number];
	type ItemShortcutAnchor = {
		targetId: string;
		label: ItemShortcutLabel;
		edge: 'top' | 'bottom';
	};
	type ItemShortcutSlot = {
		label: ItemShortcutLabel;
		target: PrimaryLauncherTarget;
	};
	type ShortcutTargetSlot = PrimaryLauncherTarget | undefined;
	type FocusSnapshot = {
		selectedPrimaryItemId: string | undefined;
		activeLauncherGroupId: string | undefined;
		itemShortcutAnchor: ItemShortcutAnchor | undefined;
	};
	type ActionSelectionSnapshot = {
		targetId: string;
		groupId?: string;
		groupItemIndex: number;
		itemSelectionKey?: string;
	};
	type ShortcutBinding =
		| { key: string; kind: 'target'; lane: ShortcutLane; target: PrimaryLauncherTarget }
		| { key: string; kind: 'parent' | 'utility' | 'text-transform'; lane: ShortcutLane };
	type StagedShortcut = {
		buffer: string;
		binding: ShortcutBinding;
		focusSnapshot: FocusSnapshot;
		selectionStart: number;
		selectionEnd: number;
		menuActionIndex?: number;
		menuOpenBufferLength?: number;
		ts: number;
	};
	type InputPreviewSegment = {
		kind: 'committed' | 'shortcut-staged' | 'bang-picker-staged';
		text: string;
	};
	type TokenCount = { count: number; href?: string; title: string };
	type TextRange = { start: number; end: number };
	type StatusHint = { key: string; label: string };
	type BangLauncherItemSource = 'my' | 'popular' | 'extended';
	type StagedActionMenu = {
		target: PrimaryLauncherTarget;
		actions: LauncherAction[];
		rootKey: string;
	};
	type SettingGroupDefinition = {
		id: string;
		title: string;
		description: string;
		aliases: readonly string[];
		currentLabel: () => string;
		options: readonly SettingOption[];
	};
	type ScoredSettingOption = Omit<SettingOption, 'description'> & {
		description: string;
		score: number;
		titleResult: Fuzzysort.Result | null;
		descriptionResult: Fuzzysort.Result | null;
	};
	type ScoredSettingGroup = Omit<SettingGroupDefinition, 'options'> & {
		score: number;
		titleResult: Fuzzysort.Result | null;
		descriptionResult: Fuzzysort.Result | null;
		options: ScoredSettingOption[];
		allOptions: ScoredSettingOption[];
	};
	type ScoredHistoryEvent = {
		event: SearchHistoryEvent;
		score: number;
		sortOrder: number;
		titleResult: Fuzzysort.Result | null;
		descriptionResult: Fuzzysort.Result | null;
	};
	type ScoredJournalGroup = {
		group: JournalSummaryGroup;
		score: number;
		sortOrder: number;
		titleResult: Fuzzysort.Result | null;
		descriptionResult: Fuzzysort.Result | null;
	};
	type ScoredJournalEntry = {
		entry: JournalEntry;
		score: number;
		sortOrder: number;
		titleResult: Fuzzysort.Result | null;
		descriptionResult: Fuzzysort.Result | null;
	};
	type ScoredJournalSignal = {
		signal: JournalSummarySignal;
		score: number;
		sortOrder: number;
		titleResult: Fuzzysort.Result | null;
		descriptionResult: Fuzzysort.Result | null;
	};
	const settingGroups: readonly SettingGroupDefinition[] = [
		{
			id: 'color-scheme',
			title: 'Color scheme',
			description: 'Theme preference for the launcher UI.',
			aliases: ['theme', 'appearance', 'dark mode', 'light mode', 'system theme'],
			currentLabel: () => colorSchemeLabels[settings.colorScheme],
			options: colorSchemes.map((value) => ({
				id: value || 'auto',
				label: colorSchemeLabels[value],
				description: value
					? `Use the ${colorSchemeLabels[value].toLowerCase()} theme.`
					: 'Follow the system theme.',
				aliases: value ? [value, `${value} theme`] : ['auto', 'system', 'system theme'],
				selected: () => settings.colorScheme === value,
				run: () => setColorScheme(value)
			}))
		},
		{
			id: 'search-provider',
			title: 'Search engine',
			description: 'Used for regular web searches.',
			aliases: ['default search', 'web search', 'search provider'],
			currentLabel: () => searchProviderLabels[settings.searchProvider],
			options: searchProviders.map((value) => ({
				id: value,
				label: value === 'custom' ? 'Custom' : searchProviderLabels[value],
				description:
					value === 'custom'
						? () => `Use custom search target: ${searchProviderLabels.custom}.`
						: `Use ${searchProviderLabels[value]} for default web searches.`,
				aliases: [value, searchProviderLabels[value], 'search engine'],
				selected: () => settings.searchProvider === value,
				run: () => setSearchProvider(value)
			}))
		},
		{
			id: 'bang-provider',
			title: 'Bang engine',
			description: 'Used for fallback bangs.',
			aliases: ['bang catalog', 'bangs catalog', 'shortcut catalog', 'bang provider'],
			currentLabel: () => bangProviderLabels[settings.bangProvider],
			options: bangProviders.map((value) => ({
				id: value,
				label: bangProviderLabels[value],
				description: `Use ${bangProviderLabels[value]} for built-in and fallback bang execution.`,
				aliases: [value, bangProviderLabels[value], 'bang catalog'],
				selected: () => settings.bangProvider === value,
				run: () => setBangProvider(value)
			}))
		},
		{
			id: 'history-recording',
			title: 'Search history',
			description: 'Controls whether executed searches are saved locally.',
			aliases: ['history', 'recording', 'off the record', 'private search'],
			currentLabel: () =>
				settings.historyRecordingEnabled ? historyRecordingLabels.on : historyRecordingLabels.off,
			options: [
				{
					id: 'on',
					label: historyRecordingLabels.on,
					description: 'Save executed searches in local History.',
					aliases: ['record', 'recording', 'history on', 'save searches'],
					selected: () => settings.historyRecordingEnabled,
					run: () => setHistoryRecordingEnabled(true)
				},
				{
					id: 'off',
					label: historyRecordingLabels.off,
					description: 'Execute future searches without saving them to History.',
					aliases: ['private', 'otr', 'off the record', 'history off'],
					selected: () => !settings.historyRecordingEnabled,
					run: () => setHistoryRecordingEnabled(false)
				}
			]
		}
	];
	let popularBangCatalog = $state<RankedZbangCatalog>();
	let extendedBangCatalog = $state<RankedZbangCatalog>();
	let loadedPopularBangProvider = $state<BangProviderId>();
	let loadedExtendedBangProvider = $state<BangProviderId>();
	let textareaElement = $state<HTMLTextAreaElement>();
	let bangEntry = $state<BangEntry | undefined>(initialUrlLauncherState.bangEntry);
	let fullscreen = $state(false);
	let wordwrap = $state(true);
	let enterNewlineRestored = $state(false);
	let enterNewlineFullscreen = $state(true);
	let selectedPrimaryItemId = $state<string>();
	let activeLauncherGroupId = $state<string>();
	let inputHistory = $state<InputFrame[]>([]);
	let keyHistory: KeyFrame[] = [];
	let pendingShortcutItemSlots: ItemShortcutSlot[] = [];
	let pendingShortcutGroupTargets: ShortcutTargetSlot[] = [];
	let pendingShortcutPrimaryTarget: PrimaryLauncherTarget | undefined;
	let pendingShortcutFocusSnapshot: FocusSnapshot | undefined;
	let pendingTripleShortcut: PendingTripleShortcut | undefined;
	let stagedShortcut = $state<StagedShortcut>();
	let itemShortcutAnchor = $state<ItemShortcutAnchor>();
	let targetShortcutInitiatorGateOpen = $state(false);
	let myBangWrite = Promise.resolve();
	let loadingPopularBangProvider = $state<BangProviderId>();
	let loadingExtendedBangProvider = $state<BangProviderId>();
	let extendedBangLoadError = $state('');
	let extendedBangLoadErrorProvider = $state<BangProviderId>();
	let doubleKeypress = $state<string>();
	let tripleKeypress = $state<string>();
	let expandedLauncherGroups = $state<Record<string, boolean>>({});
	let launcherGroupPageStarts = $state<Record<string, number>>({});
	let launcherGroupItemLimitOverrides = $state<Record<string, number>>({});
	let myBangs = $state<MyBangRecord[]>([]);
	let searchHistoryEvents = $state<SearchHistoryEvent[]>([]);
	let searchHistoryLoaded = $state(false);
	let searchHistoryError = $state('');
	let journalEntries = $state<JournalEntry[]>([]);
	let journalEntriesLoaded = $state(false);
	let journalEntriesError = $state('');
	let myBangEditor = $state<MyBangEditorSession>();
	let journalEntryEditor = $state<JournalEntryEditorSession>();
	let bangFanoutTargets = $state<string[]>([]);
	let bangFanoutError = $state('');
	let bangFanoutActionLabel = $state('Open');
	let lastUrlLauncherStateKey = $state(initialUrlLauncherState.key);
	let bangPickerPrimaryInitialized = false;
	let hadSettingsFilter = false;
	let skipNextSettingsFilterReset = false;
	let myBangsLoaded = false;
	let activeSharedMyBangPayload = '';
	let launcherGroupPagingResetKey = '';
	let shortcutScrollFrame: number | undefined;
	let shortcutScrollRequestId = 0;
	const launcherTargetElements = new Map<string, HTMLElement>();

	$effect(() => {
		const urlState = readUrlLauncherState(page.url.searchParams);

		if (urlState.key === lastUrlLauncherStateKey) return;

		applyUrlLauncherState(urlState);
	});

	const mode = $derived(getLauncherMode(modeId));
	const hasValue = $derived(Boolean(value.trim()));
	// Keep NLP signals in the shared launcher context so plugins can score and enrich items.
	const compromiseSignals = $derived(getCompromiseSignals(value));
	const myBangCodes = $derived(getBangCodeSet(myBangs));
	const popularProviderBangs = $derived(
		removeBangCodeOverlaps(popularBangCatalog?.items ?? [], myBangCodes)
	);
	const popularProviderBangCodes = $derived(getBangCodeSet([...myBangs, ...popularProviderBangs]));
	const extendedProviderBangs = $derived(
		removeBangCodeOverlaps(extendedBangCatalog?.items ?? [], popularProviderBangCodes)
	);
	const providerBangs = $derived([...popularProviderBangs, ...extendedProviderBangs]);
	const allBangs = $derived([...myBangs, ...providerBangs]);
	const preparedMyBangs = $derived(prepareBangs(myBangs));
	const preparedPopularProviderBangs = $derived(prepareBangs(popularProviderBangs));
	const preparedExtendedProviderBangs = $derived(prepareBangs(extendedProviderBangs));
	const popularProviderBangCount = $derived(popularProviderBangs.length);
	const extendedProviderBangCount = $derived(extendedProviderBangs.length);
	const bangCodeMap = $derived(createBangCodeMap(allBangs));
	const bangComposition = $derived(parseBangComposition(value, bangCodeMap, bangEntry));
	const bangPickerActive = $derived(Boolean(bangEntry));
	const bangFilterInput = $derived(bangEntry ? `!${bangEntry.fragment}` : value);
	const hasBangFilter = $derived(bangEntry ? Boolean(bangEntry.fragment.trim()) : hasValue);
	const myBangResults = $derived(
		filterBangs(bangFilterInput, preparedMyBangs, {
			limit: getBangFilterRequestedLimit('bangs.my')
		})
	);
	const popularProviderBangResults = $derived(
		filterBangs(bangFilterInput, preparedPopularProviderBangs, {
			limit: getBangFilterRequestedLimit('bangs.popular')
		})
	);
	const extendedProviderBangResults = $derived(
		filterBangs(bangFilterInput, preparedExtendedProviderBangs, {
			limit: getBangFilterRequestedLimit('bangs.extended')
		})
	);
	const launcherContext = $derived({
		text: value.trim(),
		hasValue,
		bangComposition,
		nlp: compromiseSignals
	});
	const journalSummaryGroups = $derived(
		buildJournalSummaryGroups(searchHistoryEvents, journalEntries)
	);
	const plugins = $derived(createPlugins());
	const launcherItems = $derived(
		rankItems(plugins.flatMap((plugin) => plugin.getItems?.(launcherContext) ?? []))
	);
	const launcherGroups = $derived(
		plugins.flatMap((plugin) => plugin.getGroups?.(launcherContext) ?? [])
	);
	const rootModeListItems = $derived(launcherItems.filter((item) => item.pluginId === 'mode-list'));
	const rootSearchFallbackActive = $derived(
		mode.id === 'everything' && hasValue && (bangPickerActive || rootModeListItems.length === 0)
	);
	const activePluginIds = $derived(
		rootSearchFallbackActive ? getLauncherMode('search').pluginIds : mode.pluginIds
	);
	const visibleLauncherItems = $derived(
		launcherItems.filter((item) => activePluginIds.includes(item.pluginId))
	);
	const visibleLauncherGroups = $derived(
		launcherGroups.filter(
			(group) => activePluginIds.includes(group.pluginId) && shouldRenderGroup(group)
		)
	);
	const textareaPlaceholder = $derived(getTextareaPlaceholder());
	const inputDisplayValue = $derived(getInputDisplayValue());
	const inputPreviewSegments = $derived(getInputPreviewSegments());
	const inputTokenCount = $derived(getInputTokenCount());
	const stagedShortcutStatusHint = $derived(getStagedShortcutStatusHint());
	const stagedActionMenu = $derived(getStagedActionMenu());
	const selectablePrimaryTargets = $derived(getSelectablePrimaryTargets());
	const activeLauncherGroup = $derived(getActiveLauncherGroup());
	const allShortcutItemTargets = $derived(getShortcutItemTargets());
	const shortcutItemSlots = $derived(getShortcutItemSlots());
	const shortcutGroupTargets = $derived(getShortcutGroupTargets());
	const validShortcutBindings = $derived(getValidShortcutBindings());
	const shortcutTargetIds = $derived(
		new Map([
			...shortcutItemSlots.map((slot) => [slot.target.id, slot.label] as const),
			...shortcutGroupTargets
				.map((target, index) =>
					target ? ([target.id, groupShortcutLabels[index]] as const) : undefined
				)
				.filter((entry) => entry !== undefined)
		])
	);
	const primaryLauncherTarget = $derived(
		selectablePrimaryTargets.find((target) => target.id === selectedPrimaryItemId) ??
			selectablePrimaryTargets.find(
				(target) => target.kind === 'item' && getPrimaryAction(target)?.safeForEnter
			)
	);
	const primaryLauncherItem = $derived(
		primaryLauncherTarget?.kind === 'item' ? primaryLauncherTarget.item : undefined
	);
	const secondaryLauncherItems = $derived(
		fullscreen
			? visibleLauncherItems.filter((item) => item.id !== primaryLauncherItem?.id)
			: visibleLauncherItems
	);

	onMount(() => {
		void loadMyBangs();
		applyUrlLauncherState(readUrlLauncherState(page.url.searchParams));
		window.addEventListener('hashchange', openSharedMyBangEditorFromHash);

		return () => {
			window.removeEventListener('hashchange', openSharedMyBangEditorFromHash);
			shortcutScrollRequestId += 1;
			if (shortcutScrollFrame !== undefined) {
				cancelAnimationFrame(shortcutScrollFrame);
				shortcutScrollFrame = undefined;
			}
		};
	});

	$effect(() => {
		if ((mode.id === 'history' || mode.id === 'journal') && !searchHistoryLoaded) {
			void loadSearchHistory();
		}

		if (mode.id === 'journal' && !journalEntriesLoaded) {
			void loadJournalEntries();
		}
	});

	$effect(() => {
		if (!bangPickerActive) {
			bangPickerPrimaryInitialized = false;
			return;
		}

		if (bangPickerPrimaryInitialized) return;

		const target = getDefaultBangPickerPrimaryTarget();
		if (!target) return;

		focusLauncherTarget(target);
		bangPickerPrimaryInitialized = true;
	});

	$effect(() => {
		const anchor = itemShortcutAnchor;
		if (!anchor) return;
		if (allShortcutItemTargets.some((target) => target.id === anchor.targetId)) return;

		itemShortcutAnchor = undefined;
	});

	$effect(() => {
		const nextKey = getLauncherGroupPagingResetKey();
		if (nextKey === launcherGroupPagingResetKey) return;

		launcherGroupPagingResetKey = nextKey;
		launcherGroupPageStarts = {};
		itemShortcutAnchor = undefined;
	});

	$effect(() => {
		const provider = settings.bangProvider;

		if (loadedPopularBangProvider !== provider && loadingPopularBangProvider !== provider) {
			void loadPopularBangCatalog(provider);
		}

		if (loadedExtendedBangProvider && loadedExtendedBangProvider !== provider) {
			loadedExtendedBangProvider = undefined;
			extendedBangCatalog = undefined;
			extendedBangLoadError = '';
			extendedBangLoadErrorProvider = undefined;
		}

		if (extendedBangLoadErrorProvider && extendedBangLoadErrorProvider !== provider) {
			extendedBangLoadError = '';
			extendedBangLoadErrorProvider = undefined;
		}
	});

	$effect(() => {
		if (mode.id !== 'settings') {
			hadSettingsFilter = false;
			return;
		}

		if (hasValue) {
			hadSettingsFilter = true;
			skipNextSettingsFilterReset = false;
			return;
		}

		if (hadSettingsFilter) {
			if (skipNextSettingsFilterReset) {
				skipNextSettingsFilterReset = false;
			} else if (Object.keys(expandedLauncherGroups).length) {
				expandedLauncherGroups = {};
			}
		}

		hadSettingsFilter = false;
	});

	function readUrlLauncherState(searchParams: Pick<URLSearchParams, 'get'>): UrlLauncherState {
		const stagedQuery = searchParams.get(stagedBangQueryParam);
		const value = stagedQuery ?? searchParams.get('q') ?? '';
		const shortcutSequence = sanitizeUrlShortcutSequence(
			searchParams.get(stagedShortcutSequenceParam)
		);
		const bangEntry = stagedQuery === null ? undefined : getLastBangPickerEntry(value);
		const source = stagedQuery === null ? 'q' : stagedBangQueryParam;

		return {
			key: [
				source,
				value,
				bangEntry?.triggerIndex ?? '',
				bangEntry?.fragment ?? '',
				shortcutSequence
			].join('\u0000'),
			value,
			bangEntry,
			shortcutSequence
		};
	}

	function sanitizeUrlShortcutSequence(sequence: string | null) {
		return sequence ? sequence.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 12) : '';
	}

	function getLastBangPickerEntry(input: string): BangEntry | undefined {
		let match: RegExpExecArray | null;
		let entry: BangEntry | undefined;
		const pattern = /(^|\s)!([^\s!]*)/g;

		while ((match = pattern.exec(input)) !== null) {
			entry = {
				triggerIndex: match.index + (match[1]?.length ?? 0),
				fragment: match[2] ?? ''
			};
		}

		return entry;
	}

	function applyUrlLauncherState(urlState: UrlLauncherState) {
		lastUrlLauncherStateKey = urlState.key;
		value = urlState.value;
		bangEntry = urlState.bangEntry;
		resetShortcutState();
		clearBangFanoutMessage();
		scheduleUrlLauncherStaging(urlState);
	}

	function scheduleUrlLauncherStaging(urlState: UrlLauncherState, shortcutAttempt = 0) {
		if (!urlState.bangEntry && !urlState.shortcutSequence) return;

		requestAnimationFrame(() => {
			if (urlState.key !== lastUrlLauncherStateKey) return;
			if (!textareaElement) return;

			const cursor = urlState.bangEntry
				? urlState.bangEntry.triggerIndex + urlState.bangEntry.fragment.length + 1
				: urlState.value.length;

			textareaElement.focus();
			textareaElement.setSelectionRange(cursor, cursor);
			if (urlState.bangEntry) updateBangEntry(textareaElement);
			if (!urlState.shortcutSequence) return;
			if (stageUrlShortcutSequence(urlState.shortcutSequence)) return;
			if (shortcutAttempt >= stagedShortcutUrlRetryLimit) return;

			window.setTimeout(
				() => scheduleUrlLauncherStaging(urlState, shortcutAttempt + 1),
				stagedShortcutUrlRetryDelayMs
			);
		});
	}

	function stageUrlShortcutSequence(sequence: string) {
		const [firstKey, ...continuationKeys] = [...sequence];
		if (!firstKey || !textareaElement) return false;

		resetShortcutState();
		if (!stageShortcutInitiator(firstKey)) return false;

		for (const key of continuationKeys) {
			if (
				toggleStagedActionMenuWithRootKey(key) ||
				armStagedActionMenuShortcut(key) ||
				handleStagedParentShortcut(key) ||
				openStagedItemActionMenu(key) ||
				continueStagedTargetShortcut(key)
			) {
				continue;
			}

			cancelStagedShortcut();
			return false;
		}

		return true;
	}

	function setBangAsDefaultSearch(item: ZbangRecord) {
		const code = item.code[0] ? normalizeBangCode(item.code[0]) : '';
		const label = [item.name, code].filter(Boolean).join(' ');

		setCustomSearchTarget(label, item.urls.s);
	}

	function getLauncherShareUrl() {
		const url = new URL(resolve(mode.path), window.location.href);
		url.searchParams.set('q', value.trim());

		return url.toString();
	}

	function getMyBangShareHref(draft: SharedMyBangDraft): LauncherHref | undefined {
		const hash = createSharedMyBangHash(draft);
		return hash ? (`/bang${hash}` as LauncherHref) : undefined;
	}

	function getMyBangShareUrl(draft: SharedMyBangDraft) {
		const href = getMyBangShareHref(draft);
		return href ? new URL(resolve(href), window.location.href).toString() : undefined;
	}

	function search(provider = settings.searchProvider) {
		const rawQuery = value.trim();
		const targetUrl = getSearchUrl(provider, rawQuery, settings.customSearchTemplate);
		const executionSettings = getExecutionSettingsSnapshot(provider);

		recordHistoryEvent(
			createPlainSearchHistoryEvent({
				source: 'launcher',
				rawQuery,
				settings: executionSettings,
				targetUrl
			})
		);
		window.open(targetUrl, '_blank', 'noopener,noreferrer');
	}

	async function executeBangSearch(composition = bangComposition, rawQuery = value.trim()) {
		clearBangFanoutMessage();

		const executionSettings = getExecutionSettingsSnapshot();
		const resolution = await resolveBangExecutionWithExtendedFallback(
			rawQuery,
			myBangs,
			popularProviderBangs,
			executionSettings,
			{
				extendedBangs: extendedProviderBangs,
				extendedLoaded: loadedExtendedBangProvider === executionSettings.bangProvider,
				loadExtendedBangs: () => loadExtendedBangRecords(executionSettings.bangProvider)
			}
		);
		const resolvedComposition = resolution.result.composition;
		const targetUrls = resolution.result.targetUrls;
		const actionLabel = resolvedComposition.payloadText ? 'Search' : 'Open';

		if (!targetUrls.length) return;

		bangFanoutActionLabel = actionLabel;
		recordHistoryEvent(
			createBangSearchHistoryEvent({
				source: 'launcher',
				rawQuery,
				settings: executionSettings,
				composition: resolvedComposition,
				targetUrls
			})
		);

		const failedTargets = await openBangTargetsWithRelay(targetUrls);

		if (failedTargets.length) {
			bangFanoutTargets = failedTargets;
			bangFanoutError = 'Could not open these bang targets. Check popup permissions for Whiz.';
			return;
		}

		clearBangFanoutMessage();
	}

	function openBangTargetsWithRelay(targetUrls: string[]) {
		if (!('BroadcastChannel' in window)) {
			bangFanoutError = 'Could not confirm bang targets opened in this browser.';
			return Promise.resolve(targetUrls);
		}

		const channelName = `launcher-bang-fanout-${crypto.randomUUID()}`;
		const acknowledged = Array.from({ length: targetUrls.length }, () => false);
		let acknowledgedCount = 0;
		const channel = new BroadcastChannel(channelName);

		return new Promise<string[]>((resolve) => {
			const getFailedTargets = () => targetUrls.filter((_, index) => !acknowledged[index]);

			const finish = () => {
				clearTimeout(timeout);
				channel.close();
				resolve(getFailedTargets());
			};

			const timeout = window.setTimeout(finish, bangFanoutAckTimeoutMs);

			channel.onmessage = (event: MessageEvent<{ index?: number }>) => {
				const index = event.data.index;

				if (typeof index !== 'number' || index < 1 || index > targetUrls.length) {
					return;
				}

				if (acknowledged[index - 1]) return;

				acknowledged[index - 1] = true;
				acknowledgedCount += 1;

				if (acknowledgedCount === targetUrls.length) {
					finish();
				}
			};

			for (const [offset, targetUrl] of targetUrls.entries()) {
				const relayUrl = new URL('/go/open', window.location.href);

				relayUrl.searchParams.set('target', targetUrl);
				relayUrl.searchParams.set('channel', channelName);
				relayUrl.searchParams.set('index', String(offset + 1));

				window.open(relayUrl.toString(), '_blank', 'noopener,noreferrer');
			}
		});
	}

	function clearBangFanoutMessage() {
		bangFanoutTargets = [];
		bangFanoutError = '';
		bangFanoutActionLabel = 'Open';
	}

	function getExecutionSettingsSnapshot(
		searchProvider = settings.searchProvider
	): ExecutionSettings {
		return {
			bangProvider: settings.bangProvider,
			searchProvider,
			customSearchLabel: settings.customSearchLabel,
			customSearchTemplate: settings.customSearchTemplate
		};
	}

	function recordHistoryEvent(event: SearchHistoryEvent) {
		if (!settings.historyRecordingEnabled) return;

		void recordSearchHistoryEvent(event).catch((error) =>
			console.warn('Failed to record search history', error)
		);
	}

	function getBangFanoutTargetLabel(targetUrl: string) {
		try {
			return new URL(targetUrl).hostname.replace(/^www\./, '');
		} catch {
			return targetUrl;
		}
	}

	function getBangFanoutLinkAttributes(targetUrl: string) {
		return {
			href: targetUrl,
			target: '_blank',
			rel: 'noopener noreferrer'
		};
	}

	function getBangSearchTitle(composition: BangComposition) {
		return composition.payloadText ? 'Search' : 'Open';
	}

	function getBangSearchDescription(composition: BangComposition) {
		const targets = [
			...composition.localTargets.map(({ item }) => item.name),
			...composition.forwardedTokens.map(
				(token) => `${token} via ${searchProviderLabels[settings.searchProvider]}`
			)
		].join(', ');
		const payload = composition.payloadText ? ` for "${composition.payloadText}"` : '';

		return `${targets}${payload}`;
	}

	function getInputTokenCount(): TokenCount | undefined {
		const payloadText = bangComposition.payloadText.trim();

		if (!payloadText || !hasAiBangComposition(bangComposition)) return undefined;

		const href = getTokenCounterHref(payloadText);

		return {
			count: estimateTokens(payloadText),
			href,
			title: href
				? 'Open GPT-4o token counter in HCODX'
				: 'Estimated tokens; payload is too long for a token-counter permalink'
		};
	}

	function hasAiBangComposition(composition: BangComposition) {
		return (
			composition.localTargets.some(
				({ item, token }) => isAiBangToken(token) || isAiBangRecord(item)
			) || composition.forwardedTokens.some(isAiBangToken)
		);
	}

	function isAiBangRecord(item: ZbangRecord) {
		const text = [item.name, item.urls.s, item.code.join(' '), item.tags.join(' ')].join(' ');

		return aiBangPattern.test(text) || item.code.some(isAiBangToken);
	}

	function isAiBangToken(token: string) {
		const normalized = normalizeBangCode(token);

		return (
			aiBangCodes.has(normalized) ||
			/^!(?:chatgpt|claude|deepseek|gemini|gpt-|grok|llama|mistral|openai|perplexity|phind|poe)(?:[\w.-]+)?$/.test(
				normalized
			)
		);
	}

	function estimateTokens(text: string) {
		const trimmed = text.trim();
		if (!trimmed) return 0;

		const chars = [...trimmed].length;
		const words = trimmed.match(/\S+/g)?.length ?? 0;
		const cjkChars =
			trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
				?.length ?? 0;
		const symbolChars = trimmed.match(/[{}[\]();,:.+\-*/=_`"'<>|\\#$%^&~]/g)?.length ?? 0;

		if (cjkChars > chars * 0.4) {
			return Math.ceil(Math.max(cjkChars * 0.8, chars / 2));
		}

		return Math.ceil(Math.max(words * 1.15, chars / 4.7) + symbolChars * 0.12);
	}

	function getTokenCounterHref(text: string) {
		const state = JSON.stringify({ t: text, m: 'gpt-4o' });
		const encoded = encodeBase64Utf8(state);

		if (!encoded) return undefined;

		const href = `${tokenCounterUrl}#s=${encoded}`;

		return href.length <= tokenCounterMaxUrlLength ? href : undefined;
	}

	function encodeBase64Utf8(value: string) {
		if (typeof TextEncoder === 'undefined' || typeof btoa !== 'function') {
			return undefined;
		}

		const bytes = new TextEncoder().encode(value);
		let binary = '';
		const chunkSize = 0x8000;

		for (let offset = 0; offset < bytes.length; offset += chunkSize) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
		}

		return btoa(binary);
	}

	async function loadPopularBangCatalog(provider: BangProviderId) {
		loadingPopularBangProvider = provider;
		if (loadedPopularBangProvider !== provider) popularBangCatalog = undefined;
		const result = await loadShippedBangCatalog(provider, 'popular');

		if (loadingPopularBangProvider === provider) loadingPopularBangProvider = undefined;
		if (settings.bangProvider !== provider) return;

		loadedPopularBangProvider = provider;

		if (result.error) {
			popularBangCatalog = undefined;
			console.error('Failed to load shipped popular bang catalog', result.error);
			return;
		}

		popularBangCatalog = result.data;
	}

	async function loadExtendedBangCatalog(provider: BangProviderId) {
		loadingExtendedBangProvider = provider;
		extendedBangLoadError = '';
		extendedBangLoadErrorProvider = undefined;
		const result = await loadShippedBangCatalog(provider, 'extended');

		if (loadingExtendedBangProvider === provider) loadingExtendedBangProvider = undefined;
		if (settings.bangProvider !== provider) return undefined;

		if (result.error) {
			extendedBangCatalog = undefined;
			extendedBangLoadError = getCatalogLoadErrorMessage(result.error);
			extendedBangLoadErrorProvider = provider;
			console.error('Failed to load shipped extended bang catalog', result.error);
			return undefined;
		}

		loadedExtendedBangProvider = provider;
		extendedBangCatalog = result.data;
		extendedBangLoadError = '';
		extendedBangLoadErrorProvider = undefined;
		return result.data;
	}

	async function loadExtendedBangRecords(provider: BangProviderId) {
		if (loadedExtendedBangProvider === provider && extendedBangCatalog) {
			return extendedBangCatalog.items;
		}

		return (await loadExtendedBangCatalog(provider))?.items;
	}

	function getCatalogLoadErrorMessage(error: unknown) {
		return error instanceof Error ? error.message : 'Could not load extended bangs';
	}

	async function loadMyBangs() {
		myBangs = await readMyBangs();
		myBangsLoaded = true;
		openSharedMyBangEditorFromHash();
	}

	async function loadSearchHistory() {
		searchHistoryError = '';

		try {
			searchHistoryEvents = await listSearchHistoryEvents();
			searchHistoryLoaded = true;
		} catch (error) {
			searchHistoryError = error instanceof Error ? error.message : String(error);
			searchHistoryLoaded = true;
			console.warn('Failed to load search history', error);
		}
	}

	async function loadJournalEntries() {
		journalEntriesError = '';

		try {
			journalEntries = await listJournalEntries();
			journalEntriesLoaded = true;
		} catch (error) {
			journalEntriesError = error instanceof Error ? error.message : String(error);
			journalEntriesLoaded = true;
			console.warn('Failed to load journal entries', error);
		}
	}

	function insertBang(code: string) {
		if (bangEntry) {
			const bang = code.startsWith('!') ? code : `!${code}`;
			const cursor = bangEntry.triggerIndex + bang.length + 1;
			value = `${value.slice(0, bangEntry.triggerIndex)}${bang} ${value.slice(
				bangEntry.triggerIndex + bangEntry.fragment.length + 1
			)}`;
			bangEntry = undefined;

			requestAnimationFrame(() => textareaElement?.setSelectionRange(cursor, cursor));
			return;
		}

		value = applyBang(value, code);
	}

	async function addMyBang(item: ZbangRecord) {
		if (hasBangCodeOverlap(item, myBangCodes)) return undefined;

		const nextItem = createCatalogMyBang(item);
		const nextMyBangs = [...myBangs, nextItem];
		myBangs = nextMyBangs;
		await persistMyBangs(nextMyBangs);

		return nextItem;
	}

	async function addAndEditMyBang(item: ZbangRecord) {
		const nextItem = await addMyBang(item);

		if (nextItem) openMyBangEditor(nextItem);
	}

	async function removeMyBang(item: ZbangRecord) {
		const myBang = getMyBangRecord(item);

		if (myBang) await deleteMyBang(myBang);
	}

	async function deleteMyBang(item: MyBangRecord) {
		const index = myBangs.findIndex((myBang) => myBang.id === item.id);

		if (index === -1) return;

		const nextMyBangs = [...myBangs.slice(0, index), ...myBangs.slice(index + 1)];
		myBangs = nextMyBangs;
		myBangEditor = undefined;
		await persistMyBangs(nextMyBangs);
	}

	async function saveMyBangDraft(draft: MyBangEditorSave) {
		const savingSharedImport = myBangEditor?.source === 'share';
		const now = new Date().toISOString();
		const nextItem = draft.item
			? updateMyBangFromDraft(draft.item, draft, now)
			: createCustomMyBang(draft, now);
		const nextMyBangs = draft.item
			? myBangs.map((item) => (item.id === draft.item?.id ? nextItem : item))
			: [...myBangs, nextItem];

		myBangs = nextMyBangs;
		myBangEditor = undefined;
		if (savingSharedImport) clearSharedMyBangHash();
		await persistMyBangs(nextMyBangs);
	}

	function openNewCustomBangEditor() {
		resetShortcutState();
		myBangEditor = { key: `new-${Date.now()}-${createMyBangId()}` };
	}

	function openMyBangEditor(item: ZbangRecord) {
		const myBang = getMyBangRecord(item);

		if (!myBang) return;

		resetShortcutState();
		myBangEditor = { key: `edit-${myBang.id}-${Date.now()}`, item: myBang };
	}

	function closeMyBangEditor() {
		if (myBangEditor?.source === 'share') clearSharedMyBangHash();
		myBangEditor = undefined;
		requestAnimationFrame(focusInput);
	}

	function openSharedMyBangEditorFromHash() {
		if (!myBangsLoaded) return;

		const state = readSharedMyBangHash(window.location.hash);
		if (!state || state.payload === activeSharedMyBangPayload) return;

		activeSharedMyBangPayload = state.payload;
		resetShortcutState();
		myBangEditor = {
			key: `share-${Date.now()}-${createMyBangId()}`,
			draft: state.draft,
			showValidation: true,
			source: 'share'
		};
	}

	function clearSharedMyBangHash() {
		const nextHash = removeSharedMyBangHash(window.location.hash);
		const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;

		activeSharedMyBangPayload = '';
		window.history.replaceState(window.history.state, '', nextUrl);
	}

	async function persistMyBangs(items: MyBangRecord[]) {
		const persistedItems = items.map(cloneMyBang);
		myBangWrite = myBangWrite.catch(() => undefined).then(() => writeMyBangs(persistedItems));
		await myBangWrite;
	}

	function createCustomMyBang(draft: MyBangEditorSave, now: string): MyBangRecord {
		return {
			id: createMyBangId(),
			origin: 'custom',
			createdAt: now,
			updatedAt: now,
			rank: 1,
			popularity: 1,
			name: draft.name,
			code: draft.code,
			tags: [],
			urls: { s: draft.urlTemplate }
		};
	}

	function createCatalogMyBang(item: ZbangRecord): MyBangRecord {
		const now = new Date().toISOString();
		const sourceDomain = getUrlTemplateDomain(item.urls.s);

		return {
			id: createMyBangId(),
			origin: 'catalog',
			sourceProvider: settings.bangProvider,
			sourceName: item.name,
			sourceCodes: item.code.map(normalizeBangCode),
			...(sourceDomain ? { sourceDomain } : {}),
			sourceUrlTemplate: item.urls.s,
			createdAt: now,
			updatedAt: now,
			rank: item.rank,
			popularity: item.popularity,
			name: item.name,
			code: item.code.map(normalizeBangCode),
			tags: [...item.tags],
			urls: { s: item.urls.s }
		};
	}

	function updateMyBangFromDraft(
		item: MyBangRecord,
		draft: MyBangEditorSave,
		now: string
	): MyBangRecord {
		return cloneMyBang({
			...item,
			name: draft.name,
			code: draft.code,
			urls: { s: draft.urlTemplate },
			updatedAt: now
		});
	}

	function cloneMyBang(item: MyBangRecord): MyBangRecord {
		return {
			id: item.id,
			origin: item.origin,
			...(item.sourceProvider ? { sourceProvider: item.sourceProvider } : {}),
			...(item.sourceName ? { sourceName: item.sourceName } : {}),
			...(item.sourceCodes ? { sourceCodes: item.sourceCodes.map(normalizeBangCode) } : {}),
			...(item.sourceDomain ? { sourceDomain: item.sourceDomain } : {}),
			...(item.sourceUrlTemplate ? { sourceUrlTemplate: item.sourceUrlTemplate } : {}),
			createdAt: item.createdAt,
			updatedAt: item.updatedAt,
			rank: item.rank,
			popularity: item.popularity,
			name: item.name,
			code: item.code.map(normalizeBangCode),
			tags: [...item.tags],
			urls: { s: item.urls.s }
		};
	}

	function getMyBangRecord(item: ZbangRecord) {
		const itemId = getMyBangRecordId(item);
		if (itemId) return myBangs.find((myBang) => myBang.id === itemId);

		return myBangs.find((myBang) => isSameBang(myBang, item));
	}

	function getMyBangRecordId(item: ZbangRecord) {
		const maybeMyBang = item as Partial<MyBangRecord>;

		return typeof maybeMyBang.id === 'string' ? maybeMyBang.id : undefined;
	}

	function getUrlTemplateDomain(template: string) {
		try {
			return new URL(template.replace(/%s/g, '__zbang_query__')).hostname.replace(/^www\./, '');
		} catch {
			return undefined;
		}
	}

	function isSameBang(a: ZbangRecord, b: ZbangRecord) {
		return (
			a.rank === b.rank &&
			a.name === b.name &&
			a.urls.s === b.urls.s &&
			arrayEquals(a.code, b.code) &&
			arrayEquals(a.tags, b.tags)
		);
	}

	function arrayEquals(a: string[], b: string[]) {
		return a.length === b.length && a.every((value, index) => value === b[index]);
	}

	function removeTextBeforeCursor(length: number) {
		if (!textareaElement || length <= 0) return;

		const { selectionStart, selectionEnd } = textareaElement;
		const start = Math.max(0, selectionStart - length);
		value = value.slice(0, start) + value.slice(selectionEnd);
		textareaElement.setSelectionRange(start, start);
		updateBangEntry(textareaElement);

		requestAnimationFrame(() => {
			textareaElement?.setSelectionRange(start, start);
			if (textareaElement) updateBangEntry(textareaElement);
		});
	}

	function replaceTextBeforeCursorWithBang(length: number) {
		if (!textareaElement) return;

		const { selectionStart, selectionEnd } = textareaElement;
		const start = Math.max(0, selectionStart - length);
		const replacement = isBangTrigger(value, start) ? '!' : ' !';
		const triggerIndex = start + replacement.indexOf('!');
		const cursor = triggerIndex + 1;

		value = value.slice(0, start) + replacement + value.slice(selectionEnd);
		textareaElement.value = value;
		bangEntry = { triggerIndex, fragment: '' };
		textareaElement.setSelectionRange(cursor, cursor);

		requestAnimationFrame(() => textareaElement?.setSelectionRange(cursor, cursor));
	}

	function cancelBangPickerEntry() {
		if (!bangEntry) return false;

		const tokenRange = getBangPickerTokenRange();
		const start = bangEntry.triggerIndex;
		const end =
			tokenRange?.end ??
			Math.min(value.length, bangEntry.triggerIndex + bangEntry.fragment.length + 1);

		value = value.slice(0, start) + value.slice(end);
		bangEntry = undefined;

		requestAnimationFrame(() => textareaElement?.setSelectionRange(start, start));

		return true;
	}

	function getInputDisplayValue() {
		if (!stagedShortcut) return undefined;

		return (
			value.slice(0, stagedShortcut.selectionStart) +
			stagedShortcut.buffer +
			value.slice(stagedShortcut.selectionEnd)
		);
	}

	function getInputPreviewSegments(): InputPreviewSegment[] | undefined {
		const bangTokenRange = getBangPickerTokenRange();
		if (!stagedShortcut) return getBangPickerPreviewSegments(bangTokenRange);

		const segments: InputPreviewSegment[] = [];

		appendInputPreviewValueSegments(segments, 0, stagedShortcut.selectionStart, bangTokenRange);
		appendInputPreviewSegment(segments, {
			kind: 'shortcut-staged',
			text: stagedShortcut.buffer
		});
		appendInputPreviewValueSegments(
			segments,
			stagedShortcut.selectionEnd,
			value.length,
			bangTokenRange
		);

		return segments.length ? segments : undefined;
	}

	function appendInputPreviewValueSegments(
		segments: InputPreviewSegment[],
		start: number,
		end: number,
		bangTokenRange: TextRange | undefined
	) {
		if (start >= end) return;

		if (!bangTokenRange || end <= bangTokenRange.start || start >= bangTokenRange.end) {
			appendInputPreviewSegment(segments, { kind: 'committed', text: value.slice(start, end) });
			return;
		}

		const stagedStart = Math.max(start, bangTokenRange.start);
		const stagedEnd = Math.min(end, bangTokenRange.end);

		appendInputPreviewSegment(segments, {
			kind: 'committed',
			text: value.slice(start, stagedStart)
		});
		appendInputPreviewSegment(segments, {
			kind: 'bang-picker-staged',
			text: value.slice(stagedStart, stagedEnd)
		});
		appendInputPreviewSegment(segments, { kind: 'committed', text: value.slice(stagedEnd, end) });
	}

	function appendInputPreviewSegment(
		segments: InputPreviewSegment[],
		segment: InputPreviewSegment
	) {
		if (!segment.text) return;

		const previousSegment = segments[segments.length - 1];

		if (previousSegment?.kind === segment.kind) {
			previousSegment.text += segment.text;
			return;
		}

		segments.push(segment);
	}

	function getBangPickerTokenRange(): TextRange | undefined {
		if (!bangEntry) return undefined;

		const fragmentStart = bangEntry.triggerIndex + 1;
		const whitespaceIndex = value.slice(fragmentStart).search(/\s/);
		const tokenEnd = whitespaceIndex === -1 ? value.length : fragmentStart + whitespaceIndex;
		const token = value.slice(bangEntry.triggerIndex, tokenEnd);

		if (!token.startsWith('!') || /\s/.test(token)) return undefined;

		return { start: bangEntry.triggerIndex, end: tokenEnd };
	}

	function getBangPickerPreviewSegments(
		bangTokenRange = getBangPickerTokenRange()
	): InputPreviewSegment[] | undefined {
		if (!bangTokenRange) return undefined;

		return [
			{ kind: 'committed', text: value.slice(0, bangTokenRange.start) },
			{ kind: 'bang-picker-staged', text: value.slice(bangTokenRange.start, bangTokenRange.end) },
			{ kind: 'committed', text: value.slice(bangTokenRange.end) }
		];
	}

	function getStagedShortcutStatusHint(): StatusHint | undefined {
		if (!stagedShortcut) return undefined;
		if (stagedShortcut.binding.kind === 'target') return undefined;

		const label = getStagedShortcutConfirmationLabel(stagedShortcut.binding);
		if (!label) return undefined;

		return { key: 'ENTER', label };
	}

	function getStagedActionMenu(): StagedActionMenu | undefined {
		if (!stagedShortcut?.binding || stagedShortcut.binding.kind !== 'target') return undefined;
		if (!isActionMenuLane(stagedShortcut.binding.lane)) return undefined;

		return {
			target: stagedShortcut.binding.target,
			actions: stagedShortcut.binding.target.actions,
			rootKey: stagedShortcut.binding.key
		};
	}

	function openTargetActionMenu(
		target: PrimaryLauncherTarget,
		rootKey: string,
		ts = Date.now(),
		buffer = rootKey
	) {
		if (!textareaElement) return false;

		const { selectionStart, selectionEnd } = textareaElement;
		const focusSnapshot = captureFocusSnapshot();

		captureShortcutSnapshot(rootKey);

		stagedShortcut = {
			buffer,
			binding: {
				key: rootKey,
				kind: 'target',
				lane: getTargetMenuLane(target),
				target
			},
			focusSnapshot,
			selectionStart,
			selectionEnd,
			menuActionIndex: getDefaultActionMenuIndex(target),
			menuOpenBufferLength: buffer.length,
			ts
		};

		focusLauncherTarget(target);

		requestAnimationFrame(() => {
			const cursor = selectionStart + buffer.length;
			textareaElement?.setSelectionRange(cursor, cursor);
		});

		return true;
	}

	function getStagedShortcutConfirmationLabel(binding: ShortcutBinding) {
		if (binding.kind === 'target') {
			const action = getArmedTargetAction(binding);

			if (action) return action.title ?? action.label;
			if (isActionMenuLane(binding.lane)) return undefined;

			return binding.target.title;
		}

		if (binding.kind === 'utility') {
			if (binding.key === 'Z') return fullscreen ? 'Restore input' : 'Fullscreen input';
			if (binding.key === 'X') return wordwrap ? 'Disable line wrap' : 'Enable line wrap';
			if (binding.key === 'C') {
				return (fullscreen ? enterNewlineFullscreen : enterNewlineRestored)
					? 'Run action with Enter'
					: 'Insert newline with Enter';
			}
			if (binding.key === 'V') {
				return getPrimaryAction(primaryLauncherTarget)?.label ?? 'Run primary action';
			}
		}

		if (binding.kind === 'parent') return 'Return to input';
		if (binding.kind === 'text-transform' && binding.key === ' ') return 'Insert !';
		if (binding.kind === 'text-transform' && binding.key === '.') return 'Search';

		return undefined;
	}

	function isRunnableAction(action: LauncherAction | undefined): action is LauncherRunnableAction {
		return action?.kind === 'action';
	}

	function getArmedTargetAction(binding: Extract<ShortcutBinding, { kind: 'target' }>) {
		if (isActionMenuLane(binding.lane)) {
			const defaultIndex = getDefaultActionMenuIndex(binding.target);
			const action = binding.target.actions[stagedShortcut?.menuActionIndex ?? defaultIndex];

			return isRunnableAction(action) ? action : undefined;
		}

		return getPrimaryAction(binding.target);
	}

	function getDefaultActionMenuIndex(target: PrimaryLauncherTarget) {
		const alternateIndex = target.actions.findIndex(
			(action, index) => index > 0 && isRunnableAction(action)
		);

		return alternateIndex === -1
			? (getRunnableActionIndexes(target.actions)[0] ?? 0)
			: alternateIndex;
	}

	function getActionMenuShortcutLabels(rootKey: string, actionCount: number) {
		const reservedKey = rootKey.toLocaleLowerCase();
		return itemShortcutLabels
			.filter((label) => label.toLocaleLowerCase() !== reservedKey)
			.slice(0, actionCount);
	}

	function getRunnableActionIndexes(actions: LauncherAction[]) {
		return actions.flatMap((action, index) => (isRunnableAction(action) ? [index] : []));
	}

	function getActionMenuShortcutIndex(rootKey: string, actions: LauncherAction[], key: string) {
		const actionIndexes = getRunnableActionIndexes(actions);
		const shortcutIndex = getActionMenuShortcutLabels(rootKey, actionIndexes.length).findIndex(
			(label) => shortcutKeysMatch(label, key)
		);

		return shortcutIndex === -1 ? -1 : actionIndexes[shortcutIndex];
	}

	function getActionMenuShortcutLabel(menu: StagedActionMenu, actionIndex: number) {
		const actionIndexes = getRunnableActionIndexes(menu.actions);
		const shortcutIndex = actionIndexes.indexOf(actionIndex);

		return shortcutIndex === -1
			? undefined
			: getActionMenuShortcutLabels(menu.rootKey, actionIndexes.length)[shortcutIndex];
	}

	function isItemShortcutLabel(key: string): key is ItemShortcutLabel {
		return (itemShortcutLabels as readonly string[]).includes(key);
	}

	function isGroupShortcutLabel(key: string) {
		return (groupShortcutLabels as readonly string[]).includes(key);
	}

	function getShortcutItemSlots(): ItemShortcutSlot[] {
		const anchor = itemShortcutAnchor;
		if (!anchor) return getDefaultItemShortcutSlots(allShortcutItemTargets);

		const anchorIndex = allShortcutItemTargets.findIndex((target) => target.id === anchor.targetId);
		const labelIndex = itemShortcutLabels.findIndex((label) => label === anchor.label);
		if (anchorIndex === -1 || labelIndex === -1) {
			return getDefaultItemShortcutSlots(allShortcutItemTargets);
		}

		const shortcutCount = itemShortcutLabels.length;
		let startOffset = anchor.edge === 'bottom' ? -1 : -(shortcutCount - 2);
		let endOffset = anchor.edge === 'bottom' ? shortcutCount - 2 : 1;

		if (anchorIndex + startOffset < 0) {
			const missingAbove = -(anchorIndex + startOffset);
			startOffset += missingAbove;
			endOffset += missingAbove;
		}

		if (anchorIndex + endOffset >= allShortcutItemTargets.length) {
			const missingBelow = anchorIndex + endOffset - (allShortcutItemTargets.length - 1);
			startOffset -= missingBelow;
			endOffset -= missingBelow;
		}

		startOffset = Math.max(startOffset, -anchorIndex);
		endOffset = Math.min(endOffset, allShortcutItemTargets.length - 1 - anchorIndex);

		const slots: ItemShortcutSlot[] = [];
		for (let offset = startOffset; offset <= endOffset; offset += 1) {
			const target = allShortcutItemTargets[anchorIndex + offset];
			const label = itemShortcutLabels[getWrappedItemShortcutLabelIndex(labelIndex + offset)];

			if (target && label) slots.push({ label, target });
		}

		return slots;
	}

	function getDefaultItemShortcutSlots(targets: PrimaryLauncherTarget[]): ItemShortcutSlot[] {
		return targets.slice(0, itemShortcutLabels.length).flatMap((target, index) => {
			const label = itemShortcutLabels[index];

			return label ? [{ label, target }] : [];
		});
	}

	function getWrappedItemShortcutLabelIndex(index: number) {
		return (index + itemShortcutLabels.length) % itemShortcutLabels.length;
	}

	function isItemShortcutLabelDisabled(label: string | undefined) {
		return Boolean(
			stagedActionMenu && label && (itemShortcutLabels as readonly string[]).includes(label)
		);
	}

	function isActionMenuLane(lane: ShortcutLane) {
		return lane === 'item-menu' || lane === 'group-menu';
	}

	function getTargetFocusLane(target: PrimaryLauncherTarget): ShortcutLane {
		return target.kind === 'group' ? 'group-focus' : 'item-focus';
	}

	function getTargetMenuLane(target: PrimaryLauncherTarget): ShortcutLane {
		return target.kind === 'group' ? 'group-menu' : 'item-menu';
	}

	function isShortcutInitiatorAllowed(key: string | null | undefined) {
		if (!key || key.length !== 1) return false;

		const shortcutKey = key.toLocaleUpperCase();
		const binding = validShortcutBindings.get(shortcutKey);

		if (!/^[A-Z]$/.test(shortcutKey) || !binding) return false;
		if (key === shortcutKey) return true;

		return targetShortcutInitiatorGateOpen && binding.kind === 'target';
	}

	function getInitialStagedShortcut(
		binding: ShortcutBinding,
		shortcutKey: string
	): {
		binding: ShortcutBinding;
		menuActionIndex?: number;
		menuOpenBufferLength?: number;
	} {
		if (
			binding.kind !== 'target' ||
			binding.target.kind !== 'item' ||
			primaryLauncherTarget?.kind !== 'item' ||
			primaryLauncherTarget.id !== binding.target.id
		) {
			return { binding };
		}

		return {
			binding: {
				...binding,
				lane: getTargetMenuLane(binding.target)
			},
			menuActionIndex: getDefaultActionMenuIndex(binding.target),
			menuOpenBufferLength: shortcutKey.length
		};
	}

	function stageShortcutInitiator(key: string, ts = Date.now()) {
		if (!isShortcutInitiatorAllowed(key) || !textareaElement) return false;

		const shortcutKey = key.toLocaleUpperCase();
		const binding = validShortcutBindings.get(shortcutKey);
		if (!binding) return false;
		targetShortcutInitiatorGateOpen = false;

		const { selectionStart, selectionEnd } = textareaElement;
		const focusSnapshot = captureFocusSnapshot();
		const initialShortcut = getInitialStagedShortcut(binding, shortcutKey);

		captureShortcutSnapshot(shortcutKey);

		stagedShortcut = {
			buffer: key,
			binding: initialShortcut.binding,
			focusSnapshot,
			selectionStart,
			selectionEnd,
			menuActionIndex: initialShortcut.menuActionIndex,
			menuOpenBufferLength: initialShortcut.menuOpenBufferLength,
			ts
		};

		if (
			initialShortcut.binding.kind === 'target' &&
			!isActionMenuLane(initialShortcut.binding.lane)
		) {
			focusLauncherTargetFromShortcut(initialShortcut.binding.target, shortcutKey);
		} else if (initialShortcut.binding.kind === 'target') {
			focusLauncherTarget(initialShortcut.binding.target);
		}

		requestAnimationFrame(() => {
			const cursor = selectionStart + key.length;
			textareaElement?.setSelectionRange(cursor, cursor);
		});

		return true;
	}

	function commitStagedShortcutLiteral(extraText = '') {
		if (!stagedShortcut) return false;

		const { buffer, selectionStart, selectionEnd, focusSnapshot } = stagedShortcut;
		const text = buffer + extraText;
		const cursor = selectionStart + text.length;

		value = value.slice(0, selectionStart) + text + value.slice(selectionEnd);
		restoreFocusSnapshot(focusSnapshot);
		resetShortcutState();

		requestAnimationFrame(() => {
			textareaElement?.setSelectionRange(cursor, cursor);
			if (textareaElement) updateBangEntry(textareaElement);
		});

		return true;
	}

	function cancelStagedShortcut({ restoreFocus = true } = {}) {
		if (!stagedShortcut) return false;

		const { selectionStart, focusSnapshot } = stagedShortcut;

		if (restoreFocus) restoreFocusSnapshot(focusSnapshot);
		resetShortcutState();

		requestAnimationFrame(() => textareaElement?.setSelectionRange(selectionStart, selectionStart));

		return true;
	}

	function downgradeStagedShortcut() {
		if (!stagedShortcut || stagedShortcut.binding.kind !== 'target') return false;
		if (!isActionMenuLane(stagedShortcut.binding.lane)) return false;

		const target = stagedShortcut.binding.target;
		const menuOpenBufferLength =
			stagedShortcut.menuOpenBufferLength ?? Math.min(2, stagedShortcut.buffer.length);
		if (stagedShortcut.buffer.length > menuOpenBufferLength) {
			const buffer = stagedShortcut.buffer.slice(0, -1);
			const selectedMenuKeys = buffer.slice(menuOpenBufferLength);
			const selectedMenuKey = selectedMenuKeys[selectedMenuKeys.length - 1];
			const selectedMenuActionIndex = selectedMenuKey
				? getActionMenuShortcutIndex(stagedShortcut.binding.key, target.actions, selectedMenuKey)
				: -1;
			stagedShortcut = {
				...stagedShortcut,
				buffer,
				menuActionIndex:
					selectedMenuActionIndex === -1
						? getDefaultActionMenuIndex(target)
						: selectedMenuActionIndex
			};

			requestAnimationFrame(() => {
				const cursor = stagedShortcut
					? stagedShortcut.selectionStart + stagedShortcut.buffer.length
					: undefined;
				if (cursor !== undefined) textareaElement?.setSelectionRange(cursor, cursor);
			});

			return true;
		}

		const downgradedBuffer =
			stagedShortcut.buffer.length > 1 ? stagedShortcut.buffer.slice(0, -1) : stagedShortcut.buffer;
		stagedShortcut = {
			...stagedShortcut,
			buffer: downgradedBuffer,
			menuActionIndex: undefined,
			menuOpenBufferLength: undefined,
			binding: {
				...stagedShortcut.binding,
				lane: getTargetFocusLane(target)
			}
		};

		focusLauncherTarget(target);

		requestAnimationFrame(() => {
			const cursor = stagedShortcut
				? stagedShortcut.selectionStart + stagedShortcut.buffer.length
				: undefined;
			if (cursor !== undefined) textareaElement?.setSelectionRange(cursor, cursor);
		});

		return true;
	}

	function appendStagedShortcutBinding(
		key: string,
		binding: ShortcutBinding,
		menuActionIndex?: number,
		menuOpenBufferLength?: number
	) {
		if (!stagedShortcut) return false;

		stagedShortcut = {
			...stagedShortcut,
			buffer: stagedShortcut.buffer + key,
			binding,
			menuActionIndex,
			menuOpenBufferLength,
			ts: Date.now()
		};

		requestAnimationFrame(() => {
			const cursor = stagedShortcut
				? stagedShortcut.selectionStart + stagedShortcut.buffer.length
				: undefined;
			if (cursor !== undefined) textareaElement?.setSelectionRange(cursor, cursor);
		});

		return true;
	}

	function confirmStagedShortcut() {
		if (!stagedShortcut) return false;

		executeStagedShortcutConfirmation(stagedShortcut.binding);
		resetShortcutState();

		return true;
	}

	function moveStagedActionMenuSelection(direction: 1 | -1) {
		if (!stagedShortcut || stagedShortcut.binding.kind !== 'target') return false;
		if (!isActionMenuLane(stagedShortcut.binding.lane)) return false;

		const actionIndexes = getRunnableActionIndexes(stagedShortcut.binding.target.actions);
		if (actionIndexes.length < 1) return false;

		const currentIndex =
			stagedShortcut.menuActionIndex ?? getDefaultActionMenuIndex(stagedShortcut.binding.target);
		const currentActionPosition = Math.max(0, actionIndexes.indexOf(currentIndex));
		stagedShortcut = {
			...stagedShortcut,
			menuActionIndex:
				actionIndexes[
					(currentActionPosition + direction + actionIndexes.length) % actionIndexes.length
				]
		};

		return true;
	}

	function armStagedActionMenuShortcut(key: string) {
		if (!stagedShortcut || stagedShortcut.binding.kind !== 'target') return false;
		if (!isActionMenuLane(stagedShortcut.binding.lane)) return false;

		const actionIndex = getActionMenuShortcutIndex(
			stagedShortcut.binding.key,
			stagedShortcut.binding.target.actions,
			key
		);
		if (actionIndex === -1) return false;

		focusLauncherTarget(stagedShortcut.binding.target);
		return appendStagedShortcutBinding(
			key,
			stagedShortcut.binding,
			actionIndex,
			stagedShortcut.menuOpenBufferLength ?? stagedShortcut.buffer.length
		);
	}

	function executeStagedShortcutConfirmation(binding: ShortcutBinding) {
		if (binding.kind === 'target') {
			if (!isActionMenuLane(binding.lane)) {
				const target = getShortcutConfirmationTarget(binding.target, binding.lane, binding.key);

				focusLauncherTarget(target);
				runTargetAction(getPrimaryAction(target), target);
				return;
			}

			focusLauncherTarget(binding.target);
			runTargetAction(getArmedTargetAction(binding), binding.target);
			return;
		}

		if (binding.kind === 'utility') {
			if (binding.key === 'V') {
				runTargetAction(getPrimaryAction(primaryLauncherTarget), primaryLauncherTarget);
				return;
			}

			executeUtilityShortcut(binding.key);
			return;
		}

		if (binding.kind === 'parent') {
			focusInput();
		}
	}

	function confirmBangPickerPrimaryAction() {
		if (!bangPickerActive) return false;

		runPrimaryAction();

		return true;
	}

	function fastConfirmStagedShortcut(key: string, ts: number) {
		if (!stagedShortcut) return false;
		if (isActionMenuLane(stagedShortcut.binding.lane)) return false;
		if (ts - stagedShortcut.ts >= shortcutDelay) return false;
		if (!shortcutKeysMatch(key, stagedShortcut.binding.key)) return false;

		executeStagedShortcutConfirmation(stagedShortcut.binding);
		resetShortcutState();

		return true;
	}

	function openStagedItemActionMenu(key: string) {
		if (!stagedShortcut || stagedShortcut.binding.kind !== 'target') return false;
		if (stagedShortcut.binding.lane !== getTargetFocusLane(stagedShortcut.binding.target))
			return false;
		if (!shortcutKeysMatch(key, stagedShortcut.binding.key)) return false;
		if (stagedShortcut.binding.target.kind !== 'item') return false;

		const binding = stagedShortcut.binding;
		const target = binding.target;
		focusLauncherTarget(target);

		return appendStagedShortcutBinding(
			key,
			{
				...binding,
				lane: getTargetMenuLane(target)
			},
			getDefaultActionMenuIndex(target),
			stagedShortcut.buffer.length + key.length
		);
	}

	function toggleStagedActionMenuWithRootKey(key: string) {
		if (!stagedShortcut || stagedShortcut.binding.kind !== 'target') return false;
		if (!isActionMenuLane(stagedShortcut.binding.lane)) return false;
		if (!shortcutKeysMatch(key, stagedShortcut.binding.key)) return false;

		const binding = stagedShortcut.binding;
		const target = binding.target;
		focusLauncherTarget(target);

		return appendStagedShortcutBinding(key, {
			...binding,
			lane: getTargetFocusLane(target)
		});
	}

	function continueStagedTargetShortcut(key: string) {
		if (!stagedShortcut) return false;

		const binding = validShortcutBindings.get(getShortcutBindingKey(key));
		if (!binding || binding.kind !== 'target') return false;

		const menuActionIndex = isActionMenuLane(binding.lane)
			? getDefaultActionMenuIndex(binding.target)
			: undefined;

		focusLauncherTargetFromShortcut(binding.target, key);

		return appendStagedShortcutBinding(key, binding, menuActionIndex);
	}

	function handleStagedParentShortcut(key: string) {
		if (!stagedShortcut) return false;
		if (getShortcutBindingKey(key) !== parentShortcutLabel) return false;

		const binding = stagedShortcut.binding;

		if (binding.kind === 'target' && isActionMenuLane(binding.lane)) {
			const target = binding.target;
			focusLauncherTarget(target);

			return appendStagedShortcutBinding(key, {
				...binding,
				lane: getTargetFocusLane(target)
			});
		}

		if (binding.kind === 'target' && binding.target.kind === 'item') {
			const itemTarget = binding.target;
			const group = itemTarget.groupId
				? visibleLauncherGroups.find(({ id }) => id === itemTarget.groupId)
				: undefined;
			if (group) {
				const groupTarget = createSelectableGroupTarget(group);
				focusLauncherTarget(groupTarget);

				return appendStagedShortcutBinding(key, {
					key: parentShortcutLabel,
					kind: 'target',
					lane: 'group-focus',
					target: groupTarget
				});
			}
		}

		focusInput();

		return appendStagedShortcutBinding(key, {
			key: parentShortcutLabel,
			kind: 'parent',
			lane: 'parent'
		});
	}

	function getShortcutBindingKey(key: string) {
		return key === ' ' || key === '.' ? key : key.toLocaleUpperCase();
	}

	function shortcutKeysMatch(left: string, right: string) {
		return getShortcutBindingKey(left) === getShortcutBindingKey(right);
	}

	function handleStagedShortcutKeydown(event: KeyboardEvent) {
		if (!stagedShortcut) return false;

		const ts = Date.now();

		if (event.key === 'Enter') {
			event.preventDefault();
			return confirmStagedShortcut();
		}

		if (event.key === 'Backspace') {
			event.preventDefault();
			if (downgradeStagedShortcut()) return true;
			return cancelStagedShortcut();
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			return cancelStagedShortcut();
		}

		if (
			event.key === 'ArrowDown' ||
			event.key === 'ArrowUp' ||
			event.key === 'PageDown' ||
			event.key === 'PageUp'
		) {
			if (
				(event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
				moveStagedActionMenuSelection(event.key === 'ArrowDown' ? 1 : -1)
			) {
				event.preventDefault();
				return true;
			}

			cancelStagedShortcut({ restoreFocus: false });
			return false;
		}

		if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) {
			if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) cancelStagedShortcut();
			return false;
		}

		event.preventDefault();

		if (event.repeat) return true;
		if (toggleStagedActionMenuWithRootKey(event.key)) return true;
		if (armStagedActionMenuShortcut(event.key)) return true;
		if (handleStagedParentShortcut(event.key)) return true;
		if (openStagedItemActionMenu(event.key)) return true;
		if (continueStagedTargetShortcut(event.key)) return true;
		if (fastConfirmStagedShortcut(event.key, ts)) return true;

		return commitStagedShortcutLiteral(event.key);
	}

	function handleStagedShortcutBeforeInput(event: InputEvent) {
		const { data, inputType } = event;
		const ts = Date.now();

		if (stagedShortcut && inputType === 'insertLineBreak') {
			event.preventDefault();
			return confirmStagedShortcut();
		}

		if (stagedShortcut && inputType === 'deleteContentBackward') {
			event.preventDefault();
			if (downgradeStagedShortcut()) return true;
			return cancelStagedShortcut();
		}

		if (inputType !== 'insertText' || !data) return false;

		if (stagedShortcut) {
			event.preventDefault();
			if (toggleStagedActionMenuWithRootKey(data)) return true;
			if (armStagedActionMenuShortcut(data)) return true;
			if (handleStagedParentShortcut(data)) return true;
			if (openStagedItemActionMenu(data)) return true;
			if (continueStagedTargetShortcut(data)) return true;
			if (fastConfirmStagedShortcut(data, ts)) return true;
			return commitStagedShortcutLiteral(data);
		}

		if (!isShortcutInitiatorAllowed(data)) {
			targetShortcutInitiatorGateOpen = false;
			return false;
		}

		event.preventDefault();
		return stageShortcutInitiator(data);
	}

	function handleLauncherBeforeInput(event: InputEvent) {
		const { data, inputType } = event;
		const ts = Date.now();
		const lastInput = inputHistory[0];
		const interval = lastInput ? ts - lastInput.ts : Infinity;

		if (handleStagedShortcutBeforeInput(event)) return;

		if (inputType === 'insertLineBreak' && confirmBangPickerPrimaryAction()) {
			event.preventDefault();
			return;
		}

		doubleKeypress = undefined;
		tripleKeypress = undefined;

		if (inputType === 'insertText' && data && isPendingTripleShortcut(data, ts)) {
			tripleKeypress = data;
			return;
		}

		if (
			inputType === 'insertText' &&
			data &&
			interval < shortcutDelay &&
			isShortcutInitiator(lastInput?.data) &&
			lastInput?.data?.toLowerCase() === data.toLowerCase()
		) {
			doubleKeypress = lastInput.data;
		}

		if (!doubleKeypress && inputType === 'insertText' && data && isShortcutInitiator(data)) {
			captureShortcutSnapshot(data);
		}

		inputHistory = [{ data, inputType, ts }, ...inputHistory].slice(0, 2);
	}

	function handleLauncherKeydown(event: KeyboardEvent) {
		const textarea = event.currentTarget as HTMLTextAreaElement;

		if (handleStagedShortcutKeydown(event)) return;

		if (event.key === 'Enter' && confirmBangPickerPrimaryAction()) {
			event.preventDefault();
			return;
		}

		if (handleShortcutKeydown(event)) return;

		if (!event.metaKey && !event.ctrlKey && !event.altKey && stageShortcutInitiator(event.key)) {
			event.preventDefault();
			return;
		}

		if (handlePrimaryNavigation(event)) return;

		if (event.key.length === 1 || !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
			targetShortcutInitiatorGateOpen = false;
		}

		if (event.key === 'Escape') {
			if (cancelBangPickerEntry()) {
				event.preventDefault();
				return;
			}

			bangEntry = undefined;
			return;
		}

		if (event.key === '!' && isBangTrigger(value, textarea.selectionStart)) {
			bangEntry = { triggerIndex: textarea.selectionStart, fragment: '' };
			return;
		}

		if (event.key.length === 1 && /\s/.test(event.key)) {
			bangEntry = undefined;
			return;
		}

		requestAnimationFrame(() => updateBangEntry(textarea));
	}

	function handleLauncherInput(event: Event) {
		const textarea = event.currentTarget as HTMLTextAreaElement;

		clearBangFanoutMessage();
		if (stagedShortcut) return;

		if (handleShortcutInput()) return;

		updateBangEntry(textarea);
	}

	function handleShortcutInput() {
		if (tripleKeypress && shortcutKeys.has(tripleKeypress)) {
			removeShortcutTextBeforeCursor(1);
			executeShortcut(tripleKeypress, 'triple');
			resetShortcutState();
			return true;
		}

		if (doubleKeypress && shortcutKeys.has(doubleKeypress)) {
			if (doubleKeypress === ' ') {
				replaceTextBeforeCursorWithBang(2);
				resetShortcutState();
				return true;
			}

			removeShortcutTextBeforeCursor(2);
			executeShortcut(doubleKeypress, 'double');
			resetShortcutState({ keepPendingTriple: true });
			return true;
		}

		return false;
	}

	function handleShortcutKeydown(event: KeyboardEvent) {
		if (event.key === ' ') return false;
		if (event.repeat) return false;

		const ts = Date.now();

		if (isPendingTripleShortcut(event.key, ts)) {
			event.preventDefault();
			executeShortcut(event.key, 'triple');
			resetShortcutState();

			return true;
		}

		const lastKey = keyHistory[0];
		const interval = lastKey ? ts - lastKey.ts : Infinity;

		keyHistory = [{ key: event.key, ts }, ...keyHistory].slice(0, 2);
		doubleKeypress = undefined;

		if (interval >= shortcutDelay || lastKey?.key.toLowerCase() !== event.key.toLowerCase()) {
			captureShortcutSnapshot(event.key);
			return false;
		}

		if (!isShortcutInitiator(lastKey?.key)) return false;

		doubleKeypress = lastKey.key;

		if (!shortcutKeys.has(doubleKeypress)) return false;

		event.preventDefault();
		removeShortcutTextBeforeCursor(1);
		executeShortcut(doubleKeypress, 'double');
		resetShortcutState({ keepPendingTriple: true });

		return true;
	}

	function removeShortcutTextBeforeCursor(length: number) {
		if (mode.id === 'settings' && textareaElement) {
			const { selectionStart, selectionEnd } = textareaElement;
			const start = Math.max(0, selectionStart - length);
			const nextValue = value.slice(0, start) + value.slice(selectionEnd);

			skipNextSettingsFilterReset = hasValue && !nextValue.trim();
		}

		removeTextBeforeCursor(length);
	}

	function executeShortcut(shortcutKey: string, pressCount: 'double' | 'triple') {
		const key = shortcutKey.toUpperCase();

		if (pressCount === 'triple') {
			executeTripleShortcut(key);
			return;
		}

		const utilityHandled = executeUtilityShortcut(key);
		if (utilityHandled) {
			armTripleShortcut(key, 'utility');
			return;
		}

		if (key === '.' || key === 'V') {
			const target = pendingShortcutPrimaryTarget ?? primaryLauncherTarget;

			runTargetAction(getPrimaryAction(target), target);
			armTripleShortcut(key, 'primary', target);
			return;
		}

		if (key === parentShortcutLabel) {
			focusInput();
			armTripleShortcut(key, 'parent');
			return;
		}

		const itemSlots = getSnapshotItemSlots();
		const itemSlot = itemSlots.find((slot) => slot.label === key);
		if (itemSlot) {
			focusLauncherTargetFromItemShortcut(itemSlot.target, itemSlot.label, itemSlots);
			armTripleShortcut(key, 'item-focus', itemSlot.target);
			return;
		}

		const groupFocusIndex = groupShortcutLabels.findIndex((label) => label === key);
		if (groupFocusIndex !== -1) {
			const target = getSnapshotGroupTargets()[groupFocusIndex];
			if (target) focusLauncherTargetFromShortcut(target, key);
			armTripleShortcut(key, 'group-focus', target);
			return;
		}
	}

	function executeTripleShortcut(shortcutKey: string) {
		if (!pendingTripleShortcut || pendingTripleShortcut.key !== shortcutKey) return;

		const { lane, target } = pendingTripleShortcut;

		if (target && (lane === 'item-focus' || lane === 'group-focus')) {
			const confirmationTarget = getShortcutConfirmationTarget(target, lane, shortcutKey);

			focusLauncherTarget(confirmationTarget);
			runTargetAction(getPrimaryAction(confirmationTarget), confirmationTarget);
			return;
		}

		if (target && lane === 'item-menu' && target.kind === 'item') {
			focusLauncherTarget(target);
			runTargetAction(getSecondaryAction(target), target);
			return;
		}

		if (target && lane === 'group-menu') {
			focusLauncherTarget(target);
		}
	}

	function executeUtilityShortcut(shortcutKey: string) {
		if (shortcutKey === 'Z') {
			fullscreen = !fullscreen;
			return true;
		}

		if (shortcutKey === 'X') {
			wordwrap = !wordwrap;
			return true;
		}

		if (shortcutKey === 'C') {
			if (fullscreen) {
				enterNewlineFullscreen = !enterNewlineFullscreen;
			} else {
				enterNewlineRestored = !enterNewlineRestored;
			}

			return true;
		}

		return false;
	}

	function armTripleShortcut(key: string, lane: ShortcutLane, target?: PrimaryLauncherTarget) {
		pendingTripleShortcut = { key, lane, target, ts: Date.now() };
	}

	function isPendingTripleShortcut(key: string | null | undefined, ts: number) {
		return Boolean(
			key &&
			pendingTripleShortcut &&
			pendingTripleShortcut.key.toLowerCase() === key.toLowerCase() &&
			ts - pendingTripleShortcut.ts < shortcutDelay
		);
	}

	function getSnapshotItemSlots() {
		return pendingShortcutItemSlots.length ? pendingShortcutItemSlots : shortcutItemSlots;
	}

	function getSnapshotGroupTargets() {
		return pendingShortcutGroupTargets.length ? pendingShortcutGroupTargets : shortcutGroupTargets;
	}

	function getPrimaryAction(target: PrimaryLauncherTarget | undefined) {
		const action = target?.actions[0];

		return isRunnableAction(action) ? action : undefined;
	}

	function getSecondaryAction(target: PrimaryLauncherTarget | undefined) {
		const action = target?.actions[1];

		return isRunnableAction(action) ? action : undefined;
	}

	function captureFocusSnapshot(): FocusSnapshot {
		return { selectedPrimaryItemId, activeLauncherGroupId, itemShortcutAnchor };
	}

	function restoreFocusSnapshot(snapshot: FocusSnapshot | undefined) {
		if (!snapshot) return;

		selectedPrimaryItemId = snapshot.selectedPrimaryItemId;
		activeLauncherGroupId = snapshot.activeLauncherGroupId;
		itemShortcutAnchor = snapshot.itemShortcutAnchor;
	}

	function captureShortcutSnapshot(shortcutKey: string) {
		if (!isShortcutInitiator(shortcutKey)) return;

		pendingShortcutFocusSnapshot = captureFocusSnapshot();
		pendingShortcutItemSlots = shortcutItemSlots;
		pendingShortcutGroupTargets = shortcutGroupTargets;
		pendingShortcutPrimaryTarget = primaryLauncherTarget;
	}

	function isShortcutInitiator(key: string | null | undefined) {
		if (!key) return false;

		const shortcutKey = key === ' ' || key === '.' ? key : key.toLocaleUpperCase();
		if (!validShortcutBindings.has(shortcutKey)) return false;

		// Requiring the first letter to be shifted avoids accidental triggers while typing plain text.
		return key === ' ' || key === '.' || key.toLocaleUpperCase() === key;
	}

	function resetShortcutState({ keepPendingTriple = false } = {}) {
		doubleKeypress = undefined;
		tripleKeypress = undefined;
		inputHistory = [];
		keyHistory = [];
		stagedShortcut = undefined;
		targetShortcutInitiatorGateOpen = false;
		pendingShortcutItemSlots = [];
		pendingShortcutGroupTargets = [];
		pendingShortcutPrimaryTarget = undefined;
		pendingShortcutFocusSnapshot = undefined;
		if (!keepPendingTriple) pendingTripleShortcut = undefined;
	}

	function getValidShortcutBindings() {
		const bindings = new Map<string, ShortcutBinding>();

		bindings.set(' ', { key: ' ', kind: 'text-transform', lane: 'utility' });
		bindings.set('.', { key: '.', kind: 'text-transform', lane: 'primary' });
		bindings.set(parentShortcutLabel, { key: parentShortcutLabel, kind: 'parent', lane: 'parent' });

		for (const label of utilityShortcutLabels) {
			bindings.set(label, { key: label, kind: 'utility', lane: 'utility' });
		}

		shortcutItemSlots.forEach(({ label, target }) => {
			bindings.set(label, {
				key: label,
				kind: 'target',
				lane: 'item-focus',
				target
			});
		});

		shortcutGroupTargets.forEach((target, index) => {
			if (!target) return;

			bindings.set(groupShortcutLabels[index], {
				key: groupShortcutLabels[index],
				kind: 'target',
				lane: 'group-focus',
				target
			});
		});

		return bindings;
	}

	function focusInput() {
		textareaElement?.focus();
	}

	function handleDocumentMouseDown(event: MouseEvent) {
		if (myBangEditor || journalEntryEditor) return;
		if (!(event.target instanceof HTMLElement)) return;

		const target = event.target;

		if (target.tagName === 'TEXTAREA' || target.closest('a')) return;

		requestAnimationFrame(focusInput);
	}

	function handleVisibilityChange() {
		if (myBangEditor || journalEntryEditor) return;

		if (document.visibilityState === 'visible') focusInput();
	}

	function getShortcutLabel(targetId: string) {
		return shortcutTargetIds.get(targetId);
	}

	function trackLauncherTarget(node: HTMLElement, targetId: string) {
		let currentTargetId = targetId;
		launcherTargetElements.set(currentTargetId, node);

		return {
			update(nextTargetId: string) {
				if (nextTargetId === currentTargetId) return;
				if (launcherTargetElements.get(currentTargetId) === node) {
					launcherTargetElements.delete(currentTargetId);
				}

				currentTargetId = nextTargetId;
				launcherTargetElements.set(currentTargetId, node);
			},
			destroy() {
				if (launcherTargetElements.get(currentTargetId) === node) {
					launcherTargetElements.delete(currentTargetId);
				}
			}
		};
	}

	function scheduleShortcutViewportScroll(target: PrimaryLauncherTarget | undefined) {
		if (!target || fullscreen) return;

		const requestId = ++shortcutScrollRequestId;
		const focusedTargetId = target.id;

		void tick().then(() => {
			if (requestId !== shortcutScrollRequestId) return;

			if (shortcutScrollFrame !== undefined) cancelAnimationFrame(shortcutScrollFrame);
			shortcutScrollFrame = requestAnimationFrame(() => {
				shortcutScrollFrame = undefined;
				if (requestId !== shortcutScrollRequestId) return;
				if (focusedTargetId !== selectedPrimaryItemId) return;

				scrollShortcutTargetsIntoView(focusedTargetId);
			});
		});
	}

	function scrollShortcutTargetsIntoView(focusedTargetId: string) {
		const viewport = getShortcutUsableViewport();
		const focusedElement = getLauncherTargetElement(focusedTargetId);
		const shortcutRange = getShortcutElementRange(focusedTargetId);
		const focusedRange = focusedElement ? getElementViewportRange([focusedElement]) : undefined;
		if (!shortcutRange && !focusedRange) return;

		const range =
			shortcutRange && shortcutRange.bottom - shortcutRange.top <= viewport.bottom - viewport.top
				? shortcutRange
				: focusedRange;
		if (!range) return;

		const delta =
			range.bottom > viewport.bottom
				? range.bottom - viewport.bottom
				: range.top < viewport.top
					? range.top - viewport.top
					: 0;

		if (delta !== 0) window.scrollBy({ top: delta, behavior: 'auto' });
	}

	function getShortcutUsableViewport() {
		const viewport = window.visualViewport;
		const viewportTop = viewport?.offsetTop ?? 0;
		const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
		const inputShellBottom =
			document.querySelector<HTMLElement>('.launcher-input-shell')?.getBoundingClientRect()
				.bottom ?? 0;
		const top = Math.max(viewportTop, inputShellBottom) + shortcutScrollPadding;
		const bottom = viewportBottom - shortcutScrollBottomPadding;

		return { top, bottom: Math.max(top + 1, bottom) };
	}

	function getShortcutElementRange(focusedTargetId: string) {
		const targetIds = new Set([
			...shortcutItemSlots.map((slot) => slot.target.id),
			focusedTargetId
		]);
		const elements = [...targetIds].flatMap((targetId) => {
			const element = getLauncherTargetElement(targetId);

			return element ? [element] : [];
		});

		return getElementViewportRange(elements);
	}

	function getLauncherTargetElement(targetId: string) {
		const element = launcherTargetElements.get(targetId);

		return element?.isConnected ? element : undefined;
	}

	function getElementViewportRange(elements: HTMLElement[]) {
		const rects = elements
			.map((element) => element.getBoundingClientRect())
			.filter((rect) => rect.width > 0 || rect.height > 0);
		if (!rects.length) return undefined;

		return {
			top: Math.min(...rects.map((rect) => rect.top)),
			bottom: Math.max(...rects.map((rect) => rect.bottom))
		};
	}

	function getCompactActionTarget(
		item: LauncherItem,
		focusedTarget: PrimaryLauncherTarget | undefined,
		stagedMenu: StagedActionMenu | undefined
	) {
		return stagedMenu?.target ?? focusedTarget ?? createSelectableItemTarget(item)[0];
	}

	function handleLauncherCursorChange(event: Event) {
		targetShortcutInitiatorGateOpen = false;

		if (stagedShortcut) {
			cancelStagedShortcut();
			return;
		}

		updateBangEntry(event.currentTarget as HTMLTextAreaElement);
	}

	function handleLauncherKeyup(event: Event) {
		if (stagedShortcut) return;

		updateBangEntry(event.currentTarget as HTMLTextAreaElement);
	}

	function handleLauncherBlur() {
		targetShortcutInitiatorGateOpen = false;
		cancelStagedShortcut();
	}

	function isBangTrigger(input: string, index: number) {
		const previous = input[index - 1];

		return previous === undefined || /\s/.test(previous);
	}

	function handlePrimaryNavigation(event: KeyboardEvent) {
		if (
			fullscreen ||
			enterNewlineRestored ||
			!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)
		) {
			return false;
		}

		const nextTarget =
			event.key === 'PageUp'
				? getRenderedPageNavigationTarget('start')
				: event.key === 'PageDown'
					? getRenderedPageNavigationTarget('end')
					: getAdjacentPrimaryNavigationTarget(event.key === 'ArrowUp' ? 'ArrowUp' : 'ArrowDown');

		if (!nextTarget) return false;

		event.preventDefault();
		focusLauncherTargetFromNavigation(nextTarget);
		targetShortcutInitiatorGateOpen = true;

		return true;
	}

	function getRenderedPageNavigationTarget(edge: 'start' | 'end') {
		const group = activeLauncherGroup;
		if (group) {
			const items = getVisibleGroupItems(group);
			const item = edge === 'start' ? items[0] : items[items.length - 1];
			const target = item ? createSelectableItemTarget(item, group.id)[0] : undefined;
			if (target) return target;
		}

		return edge === 'start'
			? shortcutItemSlots[0]?.target
			: shortcutItemSlots[shortcutItemSlots.length - 1]?.target;
	}

	function getAdjacentPrimaryNavigationTarget(key: 'ArrowUp' | 'ArrowDown') {
		const currentIndex = primaryLauncherTarget
			? selectablePrimaryTargets.findIndex((target) => target.id === primaryLauncherTarget.id)
			: -1;
		const nextIndex = Math.max(
			0,
			Math.min(
				selectablePrimaryTargets.length - 1,
				key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1
			)
		);

		return selectablePrimaryTargets[nextIndex];
	}

	function updateBangEntry(textarea: HTMLTextAreaElement) {
		if (!bangEntry) return;

		const cursor = textarea.selectionStart;
		const selectionEnd = textarea.selectionEnd;
		const fragmentStart = bangEntry.triggerIndex + 1;
		const whitespaceIndex = value.slice(fragmentStart).search(/\s/);
		const tokenEnd = whitespaceIndex === -1 ? value.length : fragmentStart + whitespaceIndex;

		if (cursor !== selectionEnd || cursor < fragmentStart || cursor > tokenEnd) {
			bangEntry = undefined;
			return;
		}

		const token = value.slice(bangEntry.triggerIndex, tokenEnd);

		if (!token.startsWith('!') || /\s/.test(token)) {
			bangEntry = undefined;
			return;
		}

		bangEntry = { ...bangEntry, fragment: token.slice(1) };
	}

	async function copyToClipboard() {
		await navigator.clipboard.writeText(value);
	}

	async function copyShareUrlToClipboard() {
		await navigator.clipboard.writeText(getLauncherShareUrl());
	}

	async function copyMyBangShareUrlToClipboard(draft: SharedMyBangDraft) {
		const url = getMyBangShareUrl(draft);
		if (!url) return;

		await navigator.clipboard.writeText(url);
	}

	async function pasteFromClipboard() {
		value = await navigator.clipboard.readText();
		textareaElement?.focus();
	}

	function runTargetAction(
		action: LauncherRunnableAction | undefined,
		target: PrimaryLauncherTarget | undefined
	) {
		if (!action) return;

		void runTargetActionAsync(action, target);
	}

	async function runTargetActionAsync(
		action: LauncherRunnableAction,
		target: PrimaryLauncherTarget | undefined
	) {
		const selectionSnapshot = captureActionSelectionSnapshot(target);

		try {
			const result = action.run();

			await tick();
			restoreActionSelection(selectionSnapshot);
			await result;
		} catch (error) {
			console.error('Failed to run launcher action', error);
		}
	}

	function captureActionSelectionSnapshot(
		target: PrimaryLauncherTarget | undefined
	): ActionSelectionSnapshot | undefined {
		if (!target) return undefined;

		const groupId = target.kind === 'group' ? target.group.id : target.groupId;
		const groupTargets = getActionSelectionGroupTargets(groupId);
		const groupItemIndex = groupTargets.findIndex((groupTarget) => groupTarget.id === target.id);

		return {
			targetId: target.id,
			groupId,
			groupItemIndex,
			itemSelectionKey: target.kind === 'item' ? target.item.selectionKey : undefined
		};
	}

	function restoreActionSelection(snapshot: ActionSelectionSnapshot | undefined) {
		if (!snapshot) return;
		if (selectablePrimaryTargets.some((target) => target.id === snapshot.targetId)) return;

		const groupTargets = getActionSelectionGroupTargets(snapshot.groupId);
		const adjacentGroupTarget =
			snapshot.groupItemIndex === -1
				? undefined
				: (groupTargets[snapshot.groupItemIndex] ?? groupTargets[snapshot.groupItemIndex - 1]);
		const movedTarget = snapshot.itemSelectionKey
			? selectablePrimaryTargets.find(
					(target) =>
						target.kind === 'item' && target.item.selectionKey === snapshot.itemSelectionKey
				)
			: undefined;
		const fallbackTarget =
			adjacentGroupTarget ??
			movedTarget ??
			getActionSelectionGroupTargets(activeLauncherGroup?.id)[0] ??
			selectablePrimaryTargets.find((target) => target.kind === 'item') ??
			selectablePrimaryTargets[0];

		if (fallbackTarget) {
			focusLauncherTarget(fallbackTarget);
			return;
		}

		selectedPrimaryItemId = undefined;
	}

	function getActionSelectionGroupTargets(groupId: string | undefined) {
		if (!groupId) {
			return visibleLauncherItems.flatMap((item) => createSelectableItemTarget(item));
		}

		const group = visibleLauncherGroups.find((visibleGroup) => visibleGroup.id === groupId);

		return group
			? getVisibleGroupItems(group).flatMap((item) => createSelectableItemTarget(item, group.id))
			: [];
	}

	function runPrimaryAction() {
		runTargetAction(getPrimaryAction(primaryLauncherTarget), primaryLauncherTarget);
	}

	function runStagedActionMenuAction(action: LauncherRunnableAction, event?: MouseEvent) {
		event?.preventDefault();

		const target = stagedActionMenu?.target;

		if (target) focusLauncherTarget(target);

		resetShortcutState();
		runTargetAction(action, target);
	}

	function openTargetActionMenuFromAffordance(
		target: PrimaryLauncherTarget,
		rootKey: string | undefined
	) {
		openTargetActionMenu(target, rootKey ?? '', Date.now(), '');
	}

	function toggleTargetActionMenuFromAffordance(
		target: PrimaryLauncherTarget,
		rootKey: string | undefined,
		menu: StagedActionMenu | undefined
	) {
		if (menu) {
			focusLauncherTarget(target);
			resetShortcutState();
			return;
		}

		openTargetActionMenuFromAffordance(target, rootKey);
	}

	function getStagedActionMenuArmedAction(menu: StagedActionMenu) {
		return getArmedTargetAction({
			key: menu.rootKey,
			kind: 'target',
			lane: getTargetMenuLane(menu.target),
			target: menu.target
		});
	}

	function focusLauncherTargetFromNavigation(target: PrimaryLauncherTarget) {
		if (target.kind !== 'item') {
			focusLauncherTarget(target);
			return;
		}

		const slot = shortcutItemSlots.find((slot) => slot.target.id === target.id);
		if (!slot) {
			focusLauncherTarget(target);
			return;
		}

		focusLauncherTargetFromItemShortcut(target, slot.label);
	}

	function focusLauncherTargetFromShortcut(target: PrimaryLauncherTarget, key: string) {
		const shortcutKey = getShortcutBindingKey(key);

		if (target.kind === 'group' && isGroupShortcutLabel(shortcutKey)) {
			focusLauncherGroupShortcutTarget(target);
			return;
		}

		if (target.kind !== 'item' || !isItemShortcutLabel(shortcutKey)) {
			focusLauncherTarget(target);
			return;
		}

		focusLauncherTargetFromItemShortcut(target, shortcutKey);
	}

	function focusLauncherTargetFromItemShortcut(
		target: PrimaryLauncherTarget,
		label: ItemShortcutLabel,
		slots = shortcutItemSlots
	) {
		updateItemShortcutAnchorForSelection(target, label, slots);
		focusLauncherTarget(target, { shortcutLabel: label });
	}

	function focusLauncherGroupShortcutTarget(
		target: Extract<PrimaryLauncherTarget, { kind: 'group' }>
	) {
		activeLauncherGroupId = target.group.id;
		itemShortcutAnchor = undefined;

		focusLauncherTarget(getFirstVisibleGroupItemTarget(target.group) ?? target);
	}

	function getShortcutConfirmationTarget(
		target: PrimaryLauncherTarget,
		lane: ShortcutLane,
		key: string
	) {
		if (
			lane === 'group-focus' &&
			target.kind === 'group' &&
			isGroupShortcutLabel(getShortcutBindingKey(key))
		) {
			return getFirstVisibleGroupItemTarget(target.group) ?? target;
		}

		return target;
	}

	function getFirstVisibleGroupItemTarget(group: LauncherGroup) {
		return getVisibleGroupItems(group).flatMap((item) =>
			createSelectableItemTarget(item, group.id)
		)[0];
	}

	function updateItemShortcutAnchorForSelection(
		target: PrimaryLauncherTarget,
		label: ItemShortcutLabel,
		slots: ItemShortcutSlot[]
	) {
		const slotIndex = slots.findIndex(
			(slot) => slot.target.id === target.id && slot.label === label
		);
		const targetIndex = allShortcutItemTargets.findIndex(
			(itemTarget) => itemTarget.id === target.id
		);
		if (slotIndex === -1 || targetIndex === -1) return;

		if (slotIndex === 0) {
			if (targetIndex > 0) itemShortcutAnchor = { targetId: target.id, label, edge: 'top' };
			return;
		}

		if (slotIndex === slots.length - 1 && targetIndex < allShortcutItemTargets.length - 1) {
			itemShortcutAnchor = { targetId: target.id, label, edge: 'bottom' };
		}
	}

	function focusLauncherTarget(
		target: PrimaryLauncherTarget,
		options: { shortcutLabel?: ItemShortcutLabel } = {}
	) {
		selectedPrimaryItemId = target.id;

		if (target.kind === 'group') {
			activeLauncherGroupId = target.group.id;
		} else if (target.groupId) {
			activeLauncherGroupId = target.groupId;
		}

		shiftLauncherGroupPageToEdgeTarget(target, options.shortcutLabel);
		scheduleShortcutViewportScroll(target);
	}

	function shiftLauncherGroupPageToEdgeTarget(
		target: PrimaryLauncherTarget,
		shortcutLabel?: ItemShortcutLabel
	) {
		if (target.kind !== 'item' || !target.groupId) return false;

		const group = visibleLauncherGroups.find(({ id }) => id === target.groupId);
		if (!group) return false;

		const sourceItems = getGroupSourceItems(group);
		const limit = getGroupItemLimit(group, sourceItems);
		const availableCount = getGroupAvailableItemCount(group, sourceItems);
		const visibleItems = getVisibleGroupItems(group);
		const visibleIndex = visibleItems.findIndex((item) => item.id === target.id);
		if (limit <= 0 || visibleIndex === -1 || visibleItems.length === 0) return false;

		const start = getGroupPageStart(group, sourceItems);
		const absoluteIndex = start + visibleIndex;
		let nextStart: number | undefined;
		let edge: ItemShortcutAnchor['edge'] | undefined;

		if (visibleIndex === 0 && absoluteIndex > 0) {
			nextStart = absoluteIndex - limit + 1;
			edge = 'top';
		} else if (visibleIndex === visibleItems.length - 1 && absoluteIndex < availableCount - 1) {
			nextStart = absoluteIndex;
			edge = 'bottom';
		}

		if (nextStart === undefined || !edge) return false;

		const clampedStart = getClampedGroupPageStart(group.id, availableCount, limit, nextStart);
		if (clampedStart === start) return false;

		launcherGroupPageStarts = { ...launcherGroupPageStarts, [group.id]: clampedStart };
		if (shortcutLabel) itemShortcutAnchor = { targetId: target.id, label: shortcutLabel, edge };

		return true;
	}

	function getActiveLauncherGroup() {
		const selectedTarget = selectedPrimaryItemId
			? selectablePrimaryTargets.find((target) => target.id === selectedPrimaryItemId)
			: undefined;
		const selectedGroupId =
			selectedTarget?.kind === 'group' ? selectedTarget.group.id : selectedTarget?.groupId;
		const defaultActiveGroup = getDefaultActiveLauncherGroup();

		if (defaultActiveGroup) return defaultActiveGroup;

		return (
			visibleLauncherGroups.find((group) => group.id === activeLauncherGroupId) ??
			visibleLauncherGroups.find((group) => group.id === selectedGroupId) ??
			visibleLauncherGroups[0]
		);
	}

	function getDefaultActiveLauncherGroup() {
		if (!bangPickerActive) return undefined;
		if (myBangs.length > 0) return undefined;

		return visibleLauncherGroups.find(
			(group) =>
				(group.id === 'bangs.popular' || group.id === 'bangs.extended') &&
				getVisibleGroupItems(group).length > 0
		);
	}

	function getDefaultBangPickerPrimaryTarget() {
		const myBangTarget = getInitialMyBangPickerTarget();
		if (myBangTarget) return myBangTarget;

		const group = getDefaultActiveLauncherGroup() ?? activeLauncherGroup;
		const groupTarget = group
			? getVisibleGroupItems(group).flatMap((item) => createSelectableItemTarget(item, group.id))[0]
			: undefined;

		return (
			groupTarget ?? visibleLauncherItems.flatMap((item) => createSelectableItemTarget(item))[0]
		);
	}

	function getInitialMyBangPickerTarget() {
		if (!bangPickerActive || myBangs.length === 0) return undefined;

		const myGroup = visibleLauncherGroups.find((group) => group.id === 'bangs.my');
		if (!myGroup) return undefined;

		return (
			getVisibleGroupItems(myGroup).flatMap((item) =>
				createSelectableItemTarget(item, myGroup.id)
			)[0] ?? createSelectableGroupTarget(myGroup)
		);
	}

	function getShortcutItemTargets() {
		if (!visibleLauncherGroups.length)
			return visibleLauncherItems.flatMap((item) => createSelectableItemTarget(item));

		return activeLauncherGroup
			? getVisibleGroupItems(activeLauncherGroup).flatMap((item) =>
					createSelectableItemTarget(item, activeLauncherGroup.id)
				)
			: [];
	}

	function getShortcutGroupTargets() {
		if (!visibleLauncherGroups.length || !activeLauncherGroup) return [];

		const currentIndex = visibleLauncherGroups.findIndex(
			(group) => group.id === activeLauncherGroup.id
		);
		if (currentIndex === -1) return [];

		const previousIndex =
			(currentIndex - 1 + visibleLauncherGroups.length) % visibleLauncherGroups.length;
		const nextIndex = (currentIndex + 1) % visibleLauncherGroups.length;
		const groups =
			visibleLauncherGroups.length === 1
				? [undefined, visibleLauncherGroups[currentIndex], undefined]
				: [
						visibleLauncherGroups[previousIndex],
						visibleLauncherGroups[currentIndex],
						visibleLauncherGroups[nextIndex]
					];

		return groups.map((group) => (group ? createSelectableGroupTarget(group) : undefined));
	}

	function getSelectablePrimaryTargets(): PrimaryLauncherTarget[] {
		return [
			...visibleLauncherItems.flatMap((item) => createSelectableItemTarget(item)),
			...visibleLauncherGroups.flatMap((group) => [
				createSelectableGroupTarget(group),
				...getVisibleGroupItems(group).flatMap((item) => createSelectableItemTarget(item, group.id))
			])
		];
	}

	function createSelectableGroupTarget(group: LauncherGroup): PrimaryLauncherTarget {
		return {
			id: group.id,
			kind: 'group',
			title: group.title,
			group,
			actions: [
				{
					id: `${group.id}.activate`,
					kind: 'action',
					label: getGroupPrimaryActionLabel(group),
					run: () => activateLauncherGroup(group.id)
				},
				...(group.actions ?? []).map((action) => ({ ...action, kind: 'action' as const })),
				...getGroupPagingActions(group).map((action) => ({ ...action, kind: 'action' as const })),
				...getGroupItemLimitActions(group).map((action) => ({
					...action,
					kind: 'action' as const
				}))
			]
		};
	}

	function createSelectableItemTarget(
		item: LauncherItem,
		groupId?: string
	): PrimaryLauncherTarget[] {
		if (item.kind !== 'action') return [];

		return [
			{
				id: item.id,
				kind: 'item',
				title: item.title,
				item,
				groupId,
				actions: getItemActions(item)
			}
		];
	}

	function getItemActions(item: LauncherItem): LauncherAction[] {
		if (item.kind !== 'action') return [];

		return [
			...item.actions.map((action) => ({ ...action, kind: 'action' as const })),
			...(item.menuInfo ?? []).map((info) => ({ ...info, kind: 'info' as const }))
		];
	}

	function getGroupPrimaryActionLabel(group: LauncherGroup) {
		return isLauncherGroupExpanded(group) ? 'Collapse group' : 'Expand group';
	}

	function isGroupPrimaryActionEffective(group: LauncherGroup) {
		if (group.pluginId === 'bangs') {
			if (mode.id === 'bangs' || hasBangFilter || isLauncherGroupExpanded(group)) return false;
			return group.items.length > 0;
		}

		return getGroupSourceItems(group).length > getGroupCollapsedLimit(group);
	}

	function getGroupCollapsedLimit(group: LauncherGroup) {
		return group.collapsedItemLimit ?? launcherGroupItemLimits[group.id] ?? 5;
	}

	function shouldRenderGroup(group: LauncherGroup) {
		const isBangGroup = group.pluginId === 'bangs' && (mode.id === 'bangs' || bangPickerActive);
		const isMatchedSettingsGroup =
			group.pluginId === 'settings' &&
			mode.id === 'settings' &&
			hasValue &&
			group.matchedCount !== undefined;

		return group.items.length > 0 || isBangGroup || isMatchedSettingsGroup;
	}

	function getLauncherGroupPagingResetKey() {
		return [
			mode.id,
			bangPickerActive ? 'bang-picker' : 'normal',
			bangFilterInput,
			value.trim(),
			settings.bangProvider,
			loadedPopularBangProvider ?? '',
			loadedExtendedBangProvider ?? '',
			popularProviderBangCount,
			extendedProviderBangCount,
			myBangs.length,
			searchHistoryLoaded ? searchHistoryEvents.length : 'history-loading',
			journalEntriesLoaded ? journalEntries.length : 'journal-loading'
		].join('\u0000');
	}

	function getBangFilterRequestedLimit(groupId: string) {
		const limit = getBangGroupCollapsedLimit(groupId, Number.POSITIVE_INFINITY);
		const start = Math.max(0, launcherGroupPageStarts[groupId] ?? 0);

		return start + limit;
	}

	function getBangGroupCollapsedLimit(groupId: string, itemCount: number) {
		const override = launcherGroupItemLimitOverrides[groupId];
		if (override !== undefined) return override;

		if (mode.id === 'bangs') return launcherGroupItemLimits[groupId] ?? 8;

		return Math.min(itemCount, 20);
	}

	function getBangGroupRequestedItemCount(groupId: string, itemCount: number) {
		const limit = getBangGroupCollapsedLimit(groupId, itemCount);
		const start = getClampedGroupPageStart(groupId, itemCount, limit);

		return Math.min(itemCount, start + limit);
	}

	function getGroupSourceItems(group: LauncherGroup) {
		if (group.pluginId === 'bangs' && !hasBangFilter && !isLauncherGroupExpanded(group)) return [];
		if (group.pluginId !== 'bangs' && isLauncherGroupExpanded(group)) {
			return group.allItems ?? group.items;
		}

		return group.items;
	}

	function getGroupItemLimit(group: LauncherGroup, sourceItems = getGroupSourceItems(group)) {
		const override = launcherGroupItemLimitOverrides[group.id];
		if (override !== undefined) return override;
		if (group.pluginId !== 'bangs' && isLauncherGroupExpanded(group)) return sourceItems.length;

		return getGroupCollapsedLimit(group);
	}

	function getGroupAvailableItemCount(
		group: LauncherGroup,
		sourceItems = getGroupSourceItems(group)
	) {
		return group.availableItemCount ?? sourceItems.length;
	}

	function getClampedGroupPageStart(
		groupId: string,
		itemCount: number,
		itemLimit: number,
		requestedStart = launcherGroupPageStarts[groupId] ?? 0
	) {
		if (!Number.isFinite(itemCount) || itemLimit <= 0) return 0;

		const maxStart = Math.max(0, itemCount - itemLimit);

		return Math.max(0, Math.min(maxStart, Math.floor(requestedStart)));
	}

	function getGroupPageStart(group: LauncherGroup, sourceItems = getGroupSourceItems(group)) {
		return getClampedGroupPageStart(
			group.id,
			getGroupAvailableItemCount(group, sourceItems),
			getGroupItemLimit(group, sourceItems)
		);
	}

	function getVisibleGroupItems(group: LauncherGroup) {
		const sourceItems = getGroupSourceItems(group);
		const limit = getGroupItemLimit(group, sourceItems);
		if (limit <= 0) return [];

		const start = getGroupPageStart(group, sourceItems);

		return sourceItems.slice(start, start + limit);
	}

	function getRenderedGroupItems(group: LauncherGroup) {
		const items = getVisibleGroupItems(group);

		return fullscreen ? items.filter((item) => item.id !== primaryLauncherItem?.id) : items;
	}

	function activateLauncherGroup(groupId: string) {
		const group = visibleLauncherGroups.find(({ id }) => id === groupId);

		if (group) {
			selectedPrimaryItemId = group.id;
			activeLauncherGroupId = group.id;
		}

		if (group?.pluginId === 'bangs') {
			if (mode.id === 'bangs') return;
			if (hasBangFilter) return;

			expandedLauncherGroups = { [groupId]: true };
			return;
		}

		const expanded = group
			? isLauncherGroupExpanded(group)
			: Boolean(expandedLauncherGroups[groupId]);

		expandedLauncherGroups = expanded ? {} : { [groupId]: true };
	}

	function isLauncherGroupExpanded(group: LauncherGroup) {
		if (mode.id === 'bangs' && group.pluginId === 'bangs') return true;
		if (expandedLauncherGroups[group.id] !== undefined) return expandedLauncherGroups[group.id];

		if ((mode.id !== 'bangs' && !bangPickerActive) || hasBangFilter) return false;

		if (group.id === 'bangs.my') return myBangs.length > 0;
		if (group.id === 'bangs.popular' || group.id === 'bangs.extended') return true;

		return false;
	}

	function getGroupPagingActions(group: LauncherGroup): LauncherItemAction[] {
		const sourceItems = getGroupSourceItems(group);
		const count = getGroupAvailableItemCount(group, sourceItems);
		const limit = getGroupItemLimit(group, sourceItems);
		const start = getGroupPageStart(group, sourceItems);
		const actions: LauncherItemAction[] = [];

		if (limit > 0 && start > 0) {
			actions.push({
				id: `${group.id}.page.previous`,
				label: 'Previous page',
				title: `Show previous ${formatCount(limit)} ${limit === 1 ? 'item' : 'items'}`,
				run: () => pageLauncherGroup(group, -1)
			});
		}

		if (limit > 0 && start + limit < count) {
			actions.push({
				id: `${group.id}.page.next`,
				label: 'Next page',
				title: `Show next ${formatCount(limit)} ${limit === 1 ? 'item' : 'items'}`,
				run: () => pageLauncherGroup(group, 1)
			});
		}

		return actions;
	}

	function getGroupItemLimitActions(group: LauncherGroup): LauncherItemAction[] {
		const sourceItems = getGroupSourceItems(group);
		const count = getGroupAvailableItemCount(group, sourceItems);
		const currentLimit = getGroupItemLimit(group, sourceItems);
		if (count <= 0) return [];

		return launcherGroupItemLimitOptions
			.filter((limit) => limit !== currentLimit)
			.map((limit) => ({
				id: `${group.id}.limit.${limit}`,
				label: `Show ${formatCount(limit)}`,
				title: `Show ${formatCount(limit)} items per page`,
				run: () => setLauncherGroupItemLimit(group, limit)
			}));
	}

	function pageLauncherGroup(group: LauncherGroup, direction: 1 | -1) {
		const sourceItems = getGroupSourceItems(group);
		const limit = getGroupItemLimit(group, sourceItems);
		const start = getGroupPageStart(group, sourceItems);

		setLauncherGroupPageStart(group, start + direction * limit);
	}

	function setLauncherGroupItemLimit(group: LauncherGroup, limit: number) {
		launcherGroupItemLimitOverrides = { ...launcherGroupItemLimitOverrides, [group.id]: limit };
		setLauncherGroupPageStart(group, getGroupPageStart(group));
	}

	function setLauncherGroupPageStart(group: LauncherGroup, requestedStart: number) {
		const sourceItems = getGroupSourceItems(group);
		const limit = getGroupItemLimit(group, sourceItems);
		const count = getGroupAvailableItemCount(group, sourceItems);
		const start = getClampedGroupPageStart(group.id, count, limit, requestedStart);

		launcherGroupPageStarts = { ...launcherGroupPageStarts, [group.id]: start };
		itemShortcutAnchor = undefined;
	}

	function getGroupVisibleRange(group: LauncherGroup) {
		const visibleItems = getVisibleGroupItems(group);
		if (!visibleItems.length) return undefined;

		const sourceItems = getGroupSourceItems(group);
		const count = getGroupAvailableItemCount(group, sourceItems);
		const start = getGroupPageStart(group, sourceItems);

		return {
			start,
			end: Math.min(count, start + visibleItems.length),
			count
		};
	}

	function getGroupRangeLabel(group: LauncherGroup) {
		const range = getGroupVisibleRange(group);
		if (!range || (range.start === 0 && range.end >= range.count)) return '';

		return `${formatCount(range.start + 1)}-${formatCount(range.end)}`;
	}

	function getGroupRangeTitle(group: LauncherGroup) {
		const range = getGroupVisibleRange(group);
		if (!range) return '';

		return `Showing ${formatCount(range.start + 1)}-${formatCount(range.end)} of ${formatCount(range.count)}`;
	}

	function getGroupCountLabel(group: LauncherGroup) {
		if (group.matchedCount !== undefined && group.totalCount !== undefined) {
			return `${formatCount(group.matchedCount)}/${formatCount(group.totalCount)}`;
		}

		if (group.matchedCount !== undefined) return `${formatCount(group.matchedCount)} matched`;
		if (group.totalCount !== undefined) return `${formatCount(group.totalCount)} total`;

		return '';
	}

	function getGroupCountTitle(group: LauncherGroup) {
		if (group.matchedCount !== undefined && group.totalCount !== undefined) {
			return `${formatCount(group.matchedCount)} matched of ${formatCount(group.totalCount)} total`;
		}

		if (group.matchedCount !== undefined) return `${formatCount(group.matchedCount)} matched`;
		if (group.totalCount !== undefined) return `${formatCount(group.totalCount)} total`;

		return '';
	}

	function createPlugins(): LauncherPlugin[] {
		return [
			{
				id: 'mode-list',
				getItems(context) {
					if (bangEntry) return [];

					return getModeListItems(context);
				}
			},
			{
				id: 'bang-compose',
				getItems(context) {
					if (bangEntry || !context.bangComposition.hasTargets) return [];

					return [
						{
							id: 'bang-compose.execute',
							pluginId: 'bang-compose',
							kind: 'action',
							title: getBangSearchTitle(context.bangComposition),
							description: getBangSearchDescription(context.bangComposition),
							score: 120,
							actions: [
								{
									id: 'bang-compose.execute.primary',
									label: getBangSearchTitle(context.bangComposition),
									safeForEnter: true,
									run: () => executeBangSearch(context.bangComposition, context.text)
								}
							]
						}
					];
				}
			},
			{
				id: 'bangs',
				getGroups() {
					if (!bangPickerActive && mode.id !== 'bangs') return [];

					const myActionCount = mode.id === 'bangs' && !hasBangFilter ? 1 : 0;
					const myAvailableItemCount = hasBangFilter
						? myBangResults.total
						: myBangs.length + myActionCount;
					const myRequestedItemCount = getBangGroupRequestedItemCount(
						'bangs.my',
						myAvailableItemCount
					);
					const myItems = hasBangFilter
						? createBangLauncherItems(myBangResults.items, 'my')
						: createBangLauncherItemsFromBangs(
								myBangs.slice(0, Math.max(0, myRequestedItemCount - myActionCount)),
								'my'
							);
					const visibleMyItems =
						mode.id === 'bangs' && !hasBangFilter
							? [createNewCustomBangLauncherItem(), ...myItems]
							: myItems;
					const popularAvailableItemCount = hasBangFilter
						? popularProviderBangResults.total
						: popularProviderBangCount;
					const popularItems = hasBangFilter
						? createBangLauncherItems(popularProviderBangResults.items, 'popular')
						: createBangLauncherItemsFromBangs(
								popularProviderBangs.slice(
									0,
									getBangGroupRequestedItemCount('bangs.popular', popularAvailableItemCount)
								),
								'popular'
							);
					const extendedItems = getExtendedBangLauncherItems();
					const providerLabel = bangProviderLabels[settings.bangProvider];
					const extendedAvailableItemCount =
						loadedExtendedBangProvider === settings.bangProvider
							? hasBangFilter
								? extendedProviderBangResults.total
								: extendedProviderBangCount
							: extendedItems.length;

					return [
						{
							id: 'bangs.my',
							pluginId: 'bangs',
							title: 'My bangs',
							description: 'Your custom bangs. Used first.',
							items: visibleMyItems,
							availableItemCount: myAvailableItemCount,
							collapsedItemLimit: getBangGroupCollapsedLimit('bangs.my', myAvailableItemCount),
							matchedCount: myBangResults.total,
							totalCount: myBangs.length
						},
						{
							id: 'bangs.popular',
							pluginId: 'bangs',
							title: `Popular ${providerLabel} bangs`,
							description: 'Default built-in bangs. Used as fallback.',
							items: popularItems,
							availableItemCount: popularAvailableItemCount,
							collapsedItemLimit: getBangGroupCollapsedLimit(
								'bangs.popular',
								popularAvailableItemCount
							),
							matchedCount: hasBangFilter
								? popularProviderBangResults.total
								: popularProviderBangCount,
							totalCount: popularProviderBangCount
						},
						{
							id: 'bangs.extended',
							pluginId: 'bangs',
							title: `Extended ${providerLabel} bangs`,
							description: 'Long-tail built-in bangs. Loaded on demand.',
							items: extendedItems,
							availableItemCount: extendedAvailableItemCount,
							collapsedItemLimit: getBangGroupCollapsedLimit(
								'bangs.extended',
								extendedAvailableItemCount
							),
							matchedCount:
								loadedExtendedBangProvider === settings.bangProvider
									? hasBangFilter
										? extendedProviderBangResults.total
										: extendedProviderBangCount
									: undefined,
							totalCount:
								loadedExtendedBangProvider === settings.bangProvider
									? extendedProviderBangCount
									: undefined
						}
					];
				}
			},
			{
				id: 'clipboard',
				getItems(context) {
					if (bangEntry) return [];

					if (context.hasValue) {
						return [
							{
								id: 'clipboard.copy',
								pluginId: 'clipboard',
								kind: 'action',
								title: 'Copy to clipboard',
								description: 'Copy the current launcher text.',
								score: 70,
								actions: [
									{
										id: 'clipboard.copy.primary',
										label: 'Copy to clipboard',
										run: copyToClipboard
									},
									{
										id: 'clipboard.copy.share-url',
										label: 'As URL',
										title: 'Copy share URL',
										run: copyShareUrlToClipboard
									}
								]
							}
						];
					}

					return [
						{
							id: 'clipboard.paste',
							pluginId: 'clipboard',
							kind: 'action',
							title: 'Paste from clipboard',
							description: 'Use clipboard text as the search query.',
							score: 80,
							actions: [
								{
									id: 'clipboard.paste.primary',
									label: 'Paste from clipboard',
									safeForEnter: true,
									run: pasteFromClipboard
								}
							]
						}
					];
				}
			},
			{
				id: 'search',
				getItems(context) {
					if (!context.hasValue || bangEntry || context.bangComposition.hasTargets) return [];

					return searchProviders.map((provider) => {
						const label = searchProviderLabels[provider];
						const title = `${label} Search`;

						return {
							id: `search.${provider}`,
							pluginId: 'search',
							kind: 'action',
							title,
							titleSegments: provider === 'custom' ? getBangCodeLabelSegments(title) : undefined,
							description: `for "${context.text}".`,
							score: provider === settings.searchProvider ? 100 : 65,
							actions: [
								{
									id: `search.${provider}.primary`,
									label: title,
									safeForEnter: provider === settings.searchProvider,
									run: () => search(provider)
								},
								{
									id: `search.${provider}.set-default`,
									label: 'Set as default',
									title: `Use ${searchProviderLabels[provider]} for default web searches`,
									run: () => setSearchProvider(provider)
								}
							]
						};
					});
				}
			},
			{
				id: 'settings',
				getGroups(context) {
					return getSettingsGroups(context);
				}
			},
			{
				id: 'history',
				getItems(context) {
					return getHistoryStatusItems(context);
				},
				getGroups(context) {
					return getHistoryGroups(context);
				}
			},
			{
				id: 'journal',
				getItems(context) {
					return getJournalStatusItems(context);
				},
				getGroups(context) {
					return getJournalGroups(context);
				}
			},
			{
				id: 'compromise',
				getItems(context) {
					return getCompromiseItems(context);
				}
			}
		];
	}

	function getTextareaPlaceholder() {
		if (bangPickerActive || mode.id === 'bangs') {
			return 'Filter term... (bangs will be filtered and sorted based on this term)';
		}
		if (mode.id === 'search' || rootSearchFallbackActive) {
			return 'Search query... (the query will be sent to your search provider)';
		}
		if (mode.id === 'compromise') {
			return 'Text sample... (NLP signals will be extracted from this text)';
		}
		if (mode.id === 'settings') {
			return 'Filter settings...';
		}
		if (mode.id === 'history') {
			return 'Filter history...';
		}
		if (mode.id === 'journal') {
			return 'Filter journal...';
		}

		return 'Filter term... (modes will be filtered and sorted based on this term)';
	}

	function getSettingsGroups(context: LauncherContext): LauncherGroup[] {
		const groups = context.hasValue
			? settingGroups
					.map((group) => scoreSettingGroup(group, context.text))
					.filter((group) => group.score > 0)
			: settingGroups.map((group, index) => ({
					...group,
					score: 100 - index,
					titleResult: null,
					descriptionResult: null,
					options: group.options.map((option) => createVisibleSettingOption(option, 100 - index)),
					allOptions: group.options.map((option) => createVisibleSettingOption(option, 100 - index))
				}));

		return groups
			.sort((a, b) => b.score - a.score)
			.map((group) => {
				const titleValue = group.currentLabel();

				return {
					id: `settings.${group.id}`,
					pluginId: 'settings',
					title: group.title,
					titleValue,
					titleValueSegments: getBangCodeLabelSegments(titleValue),
					description: group.description,
					titleSegments: getFuzzyHighlightSegments(group.title, group.titleResult),
					descriptionSegments: getSettingGroupDescriptionSegments(group),
					items: group.options.map((option, index) => createSettingItem(group, option, index)),
					allItems: context.hasValue
						? group.allOptions.map((option, index) => createSettingItem(group, option, index))
						: undefined,
					collapsedItemLimit: context.hasValue ? group.options.length : 0,
					matchedCount: context.hasValue ? group.options.length : undefined,
					totalCount: group.allOptions.length
				};
			});
	}

	function scoreSettingGroup(group: SettingGroupDefinition, query: string): ScoredSettingGroup {
		const groupText = getSettingSearchText(group.title, group.description, group.aliases);
		const titleResult = getSettingFuzzyResult(query, group.title);
		const descriptionResult = getSettingFuzzyResult(query, group.description);
		const groupResult = getSettingFuzzyResult(query, groupText);
		const groupScore = normalizeFuzzyScore(groupResult);
		const options = group.options
			.map((option) => scoreSettingOption(option, query))
			.filter((option) => option.score > 0);
		const allOptions = group.options.map((option) => scoreSettingOption(option, query));

		return {
			...group,
			score: Math.max(groupScore, ...options.map((option) => option.score), 0),
			titleResult,
			descriptionResult,
			options,
			allOptions
		};
	}

	function scoreSettingOption(option: SettingOption, query: string): ScoredSettingOption {
		const description = getSettingOptionDescription(option);
		const optionText = getSettingSearchText(option.label, description, option.aliases);
		const titleResult = getSettingFuzzyResult(query, option.label);
		const descriptionResult = getSettingFuzzyResult(query, description);
		const optionResult = getSettingFuzzyResult(query, optionText);

		return {
			...option,
			description,
			score: normalizeFuzzyScore(optionResult),
			titleResult,
			descriptionResult
		};
	}

	function createVisibleSettingOption(option: SettingOption, score: number): ScoredSettingOption {
		return {
			...option,
			description: getSettingOptionDescription(option),
			score,
			titleResult: null,
			descriptionResult: null
		};
	}

	function getSettingOptionDescription(option: SettingOption) {
		return typeof option.description === 'function' ? option.description() : option.description;
	}

	function getSettingSearchText(title: string, description: string, aliases: readonly string[]) {
		return `${title} ${description} ${aliases.join(' ')}`;
	}

	function getSettingFuzzyResult(query: string, target: string) {
		const result = fuzzysort.single(query, target);

		return result && result.score >= settingsMatchThreshold ? result : null;
	}

	function normalizeFuzzyScore(result: Fuzzysort.Result | null) {
		return result ? Math.max(1, Math.round(result.score * 100)) : 0;
	}

	function createSettingItem(
		group: ScoredSettingGroup,
		option: ScoredSettingOption,
		index: number
	): LauncherItem {
		const selected = option.selected?.() ?? option.label === group.currentLabel();

		return {
			id: `settings.${group.id}.${option.id}`,
			pluginId: 'settings',
			kind: 'action',
			title: option.label,
			selected,
			description: option.description,
			titleSegments: getFuzzyHighlightSegments(option.label, option.titleResult),
			descriptionSegments: getSettingDescriptionSegments(option),
			score: option.score,
			sortOrder: index,
			actions: [
				{
					id: `settings.${group.id}.${option.id}.primary`,
					label: option.label,
					run: option.run
				}
			]
		};
	}

	function getSettingDescriptionSegments(option: ScoredSettingOption) {
		if (option.id === 'custom' && !option.descriptionResult) {
			return (
				getBangCodeLabelSegments(option.description) ??
				getFuzzyHighlightSegments(option.description, null)
			);
		}

		return getFuzzyHighlightSegments(option.description, option.descriptionResult);
	}

	function getBangCodeLabelSegments(label: string) {
		const segments: BangHighlightSegment[] = [];
		const codePattern = /![^\s.]+/g;
		let lastIndex = 0;
		let codeMatch: RegExpExecArray | null;

		while ((codeMatch = codePattern.exec(label))) {
			if (codeMatch.index > lastIndex) {
				segments.push({ text: label.slice(lastIndex, codeMatch.index), matched: false });
			}

			segments.push({ text: codeMatch[0], matched: false, kind: 'bang-code' });
			lastIndex = codeMatch.index + codeMatch[0].length;
		}

		if (!segments.length) return undefined;

		if (lastIndex < label.length) segments.push({ text: label.slice(lastIndex), matched: false });

		return segments;
	}

	function getSettingGroupDescriptionSegments(group: ScoredSettingGroup) {
		return getFuzzyHighlightSegments(group.description, group.descriptionResult);
	}

	function getHistoryStatusItems(context: LauncherContext): LauncherItem[] {
		if (mode.id !== 'history') return [];

		if (!searchHistoryLoaded) {
			return [
				createHistoryInsightItem(
					'history.loading',
					'Loading history',
					'Reading executed searches saved on this device.'
				)
			];
		}

		if (searchHistoryError) {
			return [
				createHistoryInsightItem('history.error', 'Could not load history', searchHistoryError)
			];
		}

		if (!searchHistoryEvents.length) {
			return [
				createHistoryInsightItem(
					'history.empty',
					'No search history yet',
					settings.historyRecordingEnabled
						? 'Executed Whiz searches will appear here.'
						: 'Search history recording is off.'
				)
			];
		}

		if (context.hasValue && !getScoredHistoryEvents(context).length) {
			return [
				createHistoryInsightItem(
					'history.no-matches',
					'No matching history',
					'Try a query, provider, bang, host, source, or date.'
				)
			];
		}

		return [];
	}

	function createHistoryInsightItem(id: string, title: string, description: string): LauncherItem {
		return {
			id,
			pluginId: 'history',
			kind: 'insight',
			title,
			description,
			score: 100
		};
	}

	function getHistoryGroups(context: LauncherContext): LauncherGroup[] {
		if (mode.id !== 'history' || !searchHistoryLoaded || searchHistoryError) return [];

		const scoredEvents = getScoredHistoryEvents(context);
		const groups: Array<{ localDate: string; events: ScoredHistoryEvent[] }> = [];

		for (const scoredEvent of scoredEvents) {
			const localDate = scoredEvent.event.localDate;
			const group = groups.find((item) => item.localDate === localDate);

			if (group) {
				group.events.push(scoredEvent);
			} else {
				groups.push({ localDate, events: [scoredEvent] });
			}
		}

		return groups
			.sort((a, b) => b.localDate.localeCompare(a.localDate))
			.map((group) => createHistoryGroup(group.localDate, group.events, context));
	}

	function createHistoryGroup(
		localDate: string,
		groupEvents: ScoredHistoryEvent[],
		context: LauncherContext
	): LauncherGroup {
		const items = groupEvents.map(createHistoryItem);

		return {
			id: `history.${localDate}`,
			pluginId: 'history',
			title: formatHistoryDateLabel(localDate),
			description: getHistoryGroupDescription(groupEvents),
			items,
			allItems: items,
			collapsedItemLimit: context.hasValue ? items.length : historyGroupCollapsedLimit,
			matchedCount: context.hasValue ? items.length : undefined,
			totalCount: groupEvents.length
		};
	}

	function getHistoryGroupDescription(groupEvents: ScoredHistoryEvent[]) {
		const count = groupEvents.length;
		const commonHosts = getCommonHistoryHosts(groupEvents.map(({ event }) => event));
		const countLabel = `${count} ${count === 1 ? 'search' : 'searches'}`;

		return commonHosts.length ? `${countLabel} - ${commonHosts.join(', ')}` : countLabel;
	}

	function getCommonHistoryHosts(events: SearchHistoryEvent[]) {
		const counts: Record<string, number> = {};

		for (const event of events) {
			for (const host of event.targets.map((target) => target.host).filter(isString)) {
				counts[host] = (counts[host] ?? 0) + 1;
			}
		}

		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 3)
			.map(([host]) => host);
	}

	function getScoredHistoryEvents(context: LauncherContext): ScoredHistoryEvent[] {
		return scoreHistoryEvents(searchHistoryEvents, context);
	}

	function scoreHistoryEvents(
		events: SearchHistoryEvent[],
		context: LauncherContext
	): ScoredHistoryEvent[] {
		if (!context.hasValue) {
			return events.map((event, index) => ({
				event,
				score: Math.max(1, 100 - index),
				sortOrder: index,
				titleResult: null,
				descriptionResult: null
			}));
		}

		return fuzzysort
			.go(
				context.text,
				events.map((event) => ({
					event,
					searchText: getHistoryEventSearchText(event)
				})),
				{
					key: 'searchText',
					limit: events.length,
					threshold: historyMatchThreshold
				}
			)
			.map((result, index) => {
				const event = result.obj.event;
				const description = getHistoryEventDescription(event);

				return {
					event,
					score: Math.max(1, 100 + Math.round(result.score * 20)),
					sortOrder: index,
					titleResult: fuzzysort.single(context.text, event.rawQuery),
					descriptionResult: fuzzysort.single(context.text, description)
				};
			});
	}

	function createHistoryItem(scoredEvent: ScoredHistoryEvent): LauncherItem {
		const event = scoredEvent.event;
		const description = getHistoryEventDescription(event);

		return {
			id: `history.${event.id}`,
			pluginId: 'history',
			kind: 'action',
			title: event.rawQuery,
			description,
			titleSegments: getFuzzyHighlightSegments(event.rawQuery, scoredEvent.titleResult),
			descriptionSegments: getFuzzyHighlightSegments(description, scoredEvent.descriptionResult),
			selectionKey: getHistoryEventSelectionKey(event),
			score: scoredEvent.score,
			sortOrder: scoredEvent.sortOrder,
			actions: getHistoryEventActions(event),
			menuInfo: [getHistoryEventMenuInfo(event)]
		};
	}

	function getHistoryEventActions(
		event: SearchHistoryEvent
	): [LauncherItemAction, ...LauncherItemAction[]] {
		return [
			{
				id: `history.${event.id}.open`,
				label: 'Open original',
				title: 'Open the stored target URL without recording a new History event',
				safeForEnter: true,
				run: () => openSearchHistoryEvent(event)
			},
			{
				id: `history.${event.id}.reuse-query`,
				label: 'Reuse query',
				title: 'Place this query in Search mode for editing',
				run: () => reuseSearchHistoryQuery(event)
			},
			{
				id: `history.${event.id}.copy-query`,
				label: 'Copy query',
				run: () => navigator.clipboard.writeText(event.rawQuery)
			},
			{
				id: `history.${event.id}.copy-url`,
				label: event.execution.targetUrls.length > 1 ? 'Copy URLs' : 'Copy URL',
				run: () => navigator.clipboard.writeText(event.execution.targetUrls.join('\n'))
			},
			{
				id: `history.${event.id}.remove`,
				label: 'Remove from History',
				run: () => removeSearchHistoryEvent(event)
			}
		];
	}

	function getHistoryEventMenuInfo(event: SearchHistoryEvent): LauncherMenuInfo {
		return {
			id: `history.${event.id}.details`,
			details: [
				{ value: event.rawQuery },
				...event.execution.targetUrls.map((targetUrl) => ({ value: targetUrl }))
			]
		};
	}

	async function openSearchHistoryEvent(event: SearchHistoryEvent) {
		const targetUrls = event.execution.targetUrls;

		if (!targetUrls.length) return;

		clearBangFanoutMessage();

		if (targetUrls.length === 1) {
			window.open(targetUrls[0], '_blank', 'noopener,noreferrer');
			return;
		}

		bangFanoutActionLabel = 'Open';
		const failedTargets = await openBangTargetsWithRelay(targetUrls);

		if (failedTargets.length) {
			bangFanoutTargets = failedTargets;
			bangFanoutError = 'Could not open these history targets. Check popup permissions for Whiz.';
			return;
		}

		clearBangFanoutMessage();
	}

	function reuseSearchHistoryQuery(event: SearchHistoryEvent) {
		const searchParams = new URLSearchParams({ q: event.rawQuery });

		void goto(resolve(`/search?${searchParams}`));
	}

	async function removeSearchHistoryEvent(event: SearchHistoryEvent) {
		await deleteSearchHistoryEvent(event.id);
		searchHistoryEvents = searchHistoryEvents.filter((item) => item.id !== event.id);
	}

	function getHistoryEventSearchText(event: SearchHistoryEvent) {
		return [
			event.rawQuery,
			event.normalizedQuery,
			event.localDate,
			formatHistoryDateLabel(event.localDate),
			formatHistoryEventTime(event),
			getHistoryEventSourceLabel(event),
			getSearchProviderLabel(event.execution.searchProvider, event.execution.customSearchLabel),
			event.execution.searchProvider,
			event.execution.bangProvider,
			event.execution.type,
			...event.targets.flatMap((target) => [
				target.host,
				target.label,
				target.bangName,
				target.catalogProvider,
				target.kind,
				...(target.bangCodes ?? [])
			]),
			...event.execution.targetUrls
		]
			.filter(isString)
			.join(' ');
	}

	function getHistoryEventDescription(event: SearchHistoryEvent) {
		return [
			getHistoryTargetSummary(event),
			formatHistoryEventTime(event),
			getHistoryEventSourceLabel(event)
		]
			.filter(Boolean)
			.join(' - ');
	}

	function getHistoryTargetSummary(event: SearchHistoryEvent) {
		const targetLabels = event.targets
			.map((target) => target.label ?? target.host)
			.filter(isString);

		if (event.execution.targetUrls.length > 1) {
			const label = targetLabels.slice(0, 2).join(', ') || 'Multiple targets';

			return `${label} - ${event.execution.targetUrls.length} targets`;
		}

		return (
			targetLabels[0] ??
			getSearchHistoryPrimaryHost(event) ??
			getSearchProviderLabel(event.execution.searchProvider, event.execution.customSearchLabel)
		);
	}

	function getSearchHistoryPrimaryHost(event: SearchHistoryEvent) {
		const primaryTargetUrl = event.execution.primaryTargetUrl;

		try {
			return new URL(primaryTargetUrl).hostname.replace(/^www\./, '');
		} catch {
			return undefined;
		}
	}

	function getHistoryEventSelectionKey(event: SearchHistoryEvent) {
		return ['history', event.rawQuery, event.executedAt, event.execution.targetUrls.join('|')].join(
			':'
		);
	}

	function getHistoryEventSourceLabel(event: SearchHistoryEvent) {
		return event.source === 'omnibar' ? 'Omnibar' : 'Search';
	}

	function formatHistoryEventTime(event: SearchHistoryEvent) {
		const date = new Date(event.executedAt);

		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function formatHistoryDateLabel(localDate: string) {
		const today = getLocalDateString(new Date());
		const yesterday = getLocalDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

		if (localDate === today) return 'Today';
		if (localDate === yesterday) return 'Yesterday';

		const date = new Date(`${localDate}T00:00:00`);
		const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';

		return date.toLocaleDateString([], { month: 'short', day: 'numeric', year });
	}

	function getJournalStatusItems(context: LauncherContext): LauncherItem[] {
		if (mode.id !== 'journal') return [];

		if (!searchHistoryLoaded || !journalEntriesLoaded) {
			return [
				createJournalInsightItem(
					'journal.loading',
					'Loading journal',
					'Reading saved searches and manual entries on this device.'
				)
			];
		}

		if (searchHistoryError || journalEntriesError) {
			return [
				createJournalInsightItem(
					'journal.error',
					'Could not load journal',
					[searchHistoryError, journalEntriesError].filter(Boolean).join(' ')
				)
			];
		}

		if (!searchHistoryEvents.length && !journalEntries.length) {
			return [
				createTodayJournalEntryItem(),
				createJournalInsightItem(
					'journal.empty',
					'No journal activity yet',
					settings.historyRecordingEnabled
						? 'Executed Whiz searches and manual entries will appear here.'
						: 'Search history recording is off. Manual entries can still be saved.'
				)
			];
		}

		if (context.hasValue && !getScoredJournalGroups(context).length) {
			return [
				createJournalInsightItem(
					'journal.no-matches',
					'No matching journal activity',
					'Try a period, query, target, bang, or journal entry term.'
				)
			];
		}

		return context.hasValue ? [] : [createTodayJournalEntryItem()];
	}

	function createJournalInsightItem(id: string, title: string, description: string): LauncherItem {
		return {
			id,
			pluginId: 'journal',
			kind: 'insight',
			title,
			description,
			score: 100
		};
	}

	function createTodayJournalEntryItem(): LauncherItem {
		const entryDate = getLocalJournalDate();

		return {
			id: 'journal.new-today',
			pluginId: 'journal',
			kind: 'action',
			title: 'New journal entry',
			description: formatHistoryDateLabel(entryDate),
			score: 120,
			actions: [
				{
					id: 'journal.new-today.primary',
					label: 'New journal entry',
					safeForEnter: true,
					run: () => openJournalEntryEditor(entryDate)
				}
			]
		};
	}

	function getJournalGroups(context: LauncherContext): LauncherGroup[] {
		if (
			mode.id !== 'journal' ||
			!searchHistoryLoaded ||
			!journalEntriesLoaded ||
			searchHistoryError ||
			journalEntriesError
		) {
			return [];
		}

		return getScoredJournalGroups(context).map((group) => createJournalGroup(group, context));
	}

	function getScoredJournalGroups(context: LauncherContext): ScoredJournalGroup[] {
		if (!context.hasValue) {
			return journalSummaryGroups.map((group, index) => ({
				group,
				score: Math.max(1, 100 - index),
				sortOrder: index,
				titleResult: null,
				descriptionResult: null
			}));
		}

		return fuzzysort
			.go(
				context.text,
				journalSummaryGroups.map((group) => ({ group, searchText: group.searchText })),
				{
					key: 'searchText',
					limit: journalSummaryGroups.length,
					threshold: journalMatchThreshold
				}
			)
			.map((result, index) => {
				const group = result.obj.group;

				return {
					group,
					score: Math.max(1, 100 + Math.round(result.score * 20)),
					sortOrder: index,
					titleResult: fuzzysort.single(context.text, group.title),
					descriptionResult: fuzzysort.single(context.text, group.description)
				};
			});
	}

	function createJournalGroup(
		scoredGroup: ScoredJournalGroup,
		context: LauncherContext
	): LauncherGroup {
		const group = scoredGroup.group;
		const items = context.hasValue
			? getFilteredJournalGroupItems(group, context)
			: getJournalCollapsedItems(group);
		const allItems = context.hasValue ? items : getJournalExpandedItems(group, context);

		return {
			id: group.id,
			pluginId: 'journal',
			title: group.title,
			description: group.description,
			titleSegments: getFuzzyHighlightSegments(group.title, scoredGroup.titleResult),
			descriptionSegments: getFuzzyHighlightSegments(
				group.description,
				scoredGroup.descriptionResult
			),
			items,
			allItems,
			actions: [
				{
					id: `${group.id}.add-entry`,
					label: 'Add journal entry',
					title: `Create manual journal entry for ${group.title}`,
					run: () => openJournalEntryEditor(group.startDate)
				}
			],
			collapsedItemLimit: items.length,
			matchedCount: context.hasValue ? items.length : undefined,
			totalCount: group.events.length + group.entries.length
		};
	}

	function getJournalCollapsedItems(group: JournalSummaryGroup) {
		const summaryItems = getJournalSummaryItems(group);
		const entryItems = scoreJournalEntries(group.entries, undefined).map(createJournalEntryItem);

		return [...summaryItems, ...entryItems].slice(
			0,
			Math.max(journalSummaryCollapsedLimit, entryItems.length)
		);
	}

	function getJournalExpandedItems(group: JournalSummaryGroup, context: LauncherContext) {
		return [
			...getJournalSummaryItems(group),
			...scoreJournalEntries(group.entries, undefined).map(createJournalEntryItem),
			...scoreHistoryEvents(group.events, context).map(createJournalHistoryItem)
		];
	}

	function getFilteredJournalGroupItems(group: JournalSummaryGroup, context: LauncherContext) {
		const items = [
			...scoreJournalSignals(getJournalSummarySignals(group), context).map((signal) =>
				createJournalSignalItem(group, signal)
			),
			...scoreJournalEntries(group.entries, context).map(createJournalEntryItem),
			...scoreHistoryEvents(group.events, context).map(createJournalHistoryItem)
		];

		return items.length ? items : getJournalSummaryItems(group);
	}

	function getJournalSummaryItems(group: JournalSummaryGroup) {
		return scoreJournalSignals(getJournalSummarySignals(group), undefined).map((signal) =>
			createJournalSignalItem(group, signal)
		);
	}

	function getJournalSummarySignals(group: JournalSummaryGroup): JournalSummarySignal[] {
		return [
			{
				id: 'summary',
				title: 'Summary',
				description: group.description || 'Manual journal activity',
				searchText: `${group.title} ${group.description}`
			},
			...group.signals
		];
	}

	function scoreJournalSignals(
		signals: JournalSummarySignal[],
		context: LauncherContext | undefined
	): ScoredJournalSignal[] {
		if (!context?.hasValue) {
			return signals.map((signal, index) => ({
				signal,
				score: Math.max(1, 100 - index),
				sortOrder: index,
				titleResult: null,
				descriptionResult: null
			}));
		}

		return fuzzysort
			.go(
				context.text,
				signals.map((signal) => ({ signal, searchText: signal.searchText })),
				{
					key: 'searchText',
					limit: signals.length,
					threshold: journalMatchThreshold
				}
			)
			.map((result, index) => {
				const signal = result.obj.signal;

				return {
					signal,
					score: Math.max(1, 100 + Math.round(result.score * 20)),
					sortOrder: index,
					titleResult: fuzzysort.single(context.text, signal.title),
					descriptionResult: fuzzysort.single(context.text, signal.description)
				};
			});
	}

	function createJournalSignalItem(
		group: JournalSummaryGroup,
		scoredSignal: ScoredJournalSignal
	): LauncherItem {
		const signal = scoredSignal.signal;

		return {
			id: `${group.id}.signal.${signal.id}`,
			pluginId: 'journal',
			kind: 'insight',
			title: signal.title,
			description: signal.description,
			titleSegments: getFuzzyHighlightSegments(signal.title, scoredSignal.titleResult),
			descriptionSegments: getFuzzyHighlightSegments(
				signal.description,
				scoredSignal.descriptionResult
			),
			score: scoredSignal.score,
			sortOrder: scoredSignal.sortOrder
		};
	}

	function scoreJournalEntries(
		entries: JournalEntry[],
		context: LauncherContext | undefined
	): ScoredJournalEntry[] {
		if (!context?.hasValue) {
			return entries.map((entry, index) => ({
				entry,
				score: Math.max(1, 98 - index),
				sortOrder: index,
				titleResult: null,
				descriptionResult: null
			}));
		}

		return fuzzysort
			.go(
				context.text,
				entries.map((entry) => ({ entry, searchText: getJournalEntrySearchText(entry) })),
				{
					key: 'searchText',
					limit: entries.length,
					threshold: journalMatchThreshold
				}
			)
			.map((result, index) => {
				const entry = result.obj.entry;
				const title = getJournalEntryTitle(entry);
				const description = getJournalEntryDescription(entry);

				return {
					entry,
					score: Math.max(1, 100 + Math.round(result.score * 20)),
					sortOrder: index,
					titleResult: fuzzysort.single(context.text, title),
					descriptionResult: fuzzysort.single(context.text, description)
				};
			});
	}

	function createJournalEntryItem(scoredEntry: ScoredJournalEntry): LauncherItem {
		const entry = scoredEntry.entry;
		const title = getJournalEntryTitle(entry);
		const description = getJournalEntryDescription(entry);

		return {
			id: `journal.entry.${entry.id}`,
			pluginId: 'journal-entry',
			kind: 'action',
			title,
			description,
			titleSegments: getFuzzyHighlightSegments(title, scoredEntry.titleResult),
			descriptionSegments: getFuzzyHighlightSegments(description, scoredEntry.descriptionResult),
			selectionKey: getJournalEntrySelectionKey(entry),
			score: scoredEntry.score,
			sortOrder: scoredEntry.sortOrder,
			actions: getJournalEntryActions(entry),
			menuInfo: [getJournalEntryMenuInfo(entry)]
		};
	}

	function getJournalEntryDescription(entry: JournalEntry) {
		return ['Manual entry', formatHistoryDateLabel(entry.entryDate), getJournalEntryExcerpt(entry)]
			.filter(Boolean)
			.join(' - ');
	}

	function getJournalEntryActions(
		entry: JournalEntry
	): [LauncherItemAction, ...LauncherItemAction[]] {
		return [
			{
				id: `journal.entry.${entry.id}.edit`,
				label: 'Edit entry',
				safeForEnter: true,
				run: () => openJournalEntryEditor(entry.entryDate, entry)
			},
			{
				id: `journal.entry.${entry.id}.delete`,
				label: 'Delete entry',
				run: () => deleteManualJournalEntry(entry)
			}
		];
	}

	function getJournalEntryMenuInfo(entry: JournalEntry): LauncherMenuInfo {
		return {
			id: `journal.entry.${entry.id}.details`,
			details: [{ value: entry.entryDate }, { value: entry.bodyMarkdown }]
		};
	}

	function getJournalEntrySearchText(entry: JournalEntry) {
		return [
			entry.entryDate,
			formatHistoryDateLabel(entry.entryDate),
			getJournalEntryTitle(entry),
			getJournalEntryExcerpt(entry),
			entry.bodyMarkdown,
			...(entry.tags ?? [])
		]
			.filter(isString)
			.join(' ');
	}

	function createJournalHistoryItem(scoredEvent: ScoredHistoryEvent): LauncherItem {
		const event = scoredEvent.event;
		const description = getHistoryEventDescription(event);

		return {
			id: `journal.history.${event.id}`,
			pluginId: 'journal-history',
			kind: 'action',
			title: event.rawQuery,
			description,
			titleSegments: getFuzzyHighlightSegments(event.rawQuery, scoredEvent.titleResult),
			descriptionSegments: getFuzzyHighlightSegments(description, scoredEvent.descriptionResult),
			selectionKey: `journal:${getHistoryEventSelectionKey(event)}`,
			score: scoredEvent.score,
			sortOrder: scoredEvent.sortOrder,
			actions: getJournalHistoryEventActions(event),
			menuInfo: [getHistoryEventMenuInfo(event)]
		};
	}

	function getJournalHistoryEventActions(
		event: SearchHistoryEvent
	): [LauncherItemAction, ...LauncherItemAction[]] {
		return [
			{
				id: `journal.history.${event.id}.open`,
				label: 'Open original',
				title: 'Open the stored target URL without recording a new History event',
				safeForEnter: true,
				run: () => openSearchHistoryEvent(event)
			},
			{
				id: `journal.history.${event.id}.reuse-query`,
				label: 'Reuse query',
				title: 'Place this query in Search mode for editing',
				run: () => reuseSearchHistoryQuery(event)
			},
			{
				id: `journal.history.${event.id}.remove`,
				label: 'Remove from History',
				run: () => removeSearchHistoryEvent(event)
			}
		];
	}

	function openJournalEntryEditor(entryDate: string, entry?: JournalEntry) {
		journalEntryEditor = {
			key: `journal-${Date.now()}-${entry?.id ?? entryDate}`,
			entryDate,
			entry
		};
	}

	function closeJournalEntryEditor() {
		journalEntryEditor = undefined;
	}

	async function saveJournalEntryDraft(draft: JournalEntryEditorSave) {
		const savedEntry = draft.entry
			? await updateJournalEntry({
					...draft.entry,
					entryDate: draft.entryDate,
					bodyMarkdown: draft.bodyMarkdown
				})
			: await createJournalEntry({
					entryDate: draft.entryDate,
					bodyMarkdown: draft.bodyMarkdown
				});

		journalEntries = sortJournalEntries([
			savedEntry,
			...journalEntries.filter((entry) => entry.id !== savedEntry.id)
		]);
		journalEntryEditor = undefined;
	}

	async function deleteManualJournalEntry(entry: JournalEntry) {
		await deleteJournalEntry(entry.id);
		journalEntries = journalEntries.filter((item) => item.id !== entry.id);

		if (journalEntryEditor?.entry?.id === entry.id) {
			journalEntryEditor = undefined;
		}
	}

	function sortJournalEntries(entries: JournalEntry[]) {
		return [...entries].sort(
			(a, b) => b.entryDate.localeCompare(a.entryDate) || b.updatedAt.localeCompare(a.updatedAt)
		);
	}

	function getJournalEntrySelectionKey(entry: JournalEntry) {
		return ['journal-entry', entry.id, entry.entryDate, entry.updatedAt].join(':');
	}

	function getLocalDateString(date: Date) {
		const year = date.getFullYear().toString().padStart(4, '0');
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');

		return `${year}-${month}-${day}`;
	}

	function isString(value: unknown): value is string {
		return typeof value === 'string' && value.length > 0;
	}

	function getModeListItems(context: LauncherContext): LauncherItem[] {
		const modes = launcherModes.filter((mode) => mode.id !== 'everything');

		if (!context.hasValue) {
			return modes.map((mode, index) => createModeListItem(mode, 120 - index, index, index));
		}

		return fuzzysort
			.go(
				context.text,
				modes.map((mode) => ({
					mode,
					searchText: `${mode.label} ${mode.description} ${mode.keywords.join(' ')}`
				})),
				{
					key: 'searchText',
					limit: modes.length,
					threshold: 0.4
				}
			)
			.map((result, index) => {
				const { mode } = result.obj;
				const titleResult = fuzzysort.single(context.text, mode.label);

				return createModeListItem(mode, 100 + Math.round(result.score * 20), index, undefined, {
					titleSegments: getFuzzyHighlightSegments(mode.label, titleResult)
				});
			});
	}

	function createBangLauncherItems(
		results: BangFilterResult[],
		source: BangLauncherItemSource
	): LauncherItem[] {
		return results.map(({ item, score, highlights }, index) => {
			const itemId = `bangs.${source}.${index}.${item.code[0] ?? item.rank}`;

			return {
				id: itemId,
				pluginId: 'bangs',
				kind: 'action' as const,
				title: item.name,
				description: getBangItemDescription(item),
				titleSegments: highlights.name,
				descriptionSegments: getBangDescriptionSegments(highlights),
				selectionKey: getBangSelectionKey(item),
				rank: item.rank,
				score,
				sortOrder: index,
				actions: getBangItemActions(item, source, itemId),
				menuInfo: [getBangMenuInfo(item, highlights)]
			};
		});
	}

	function createNewCustomBangLauncherItem(): LauncherItem {
		return {
			id: 'bangs.my.new-custom',
			pluginId: 'bangs',
			kind: 'action',
			title: 'New custom bang',
			description: 'Create a MyBang',
			selectionKey: 'bang:new-custom',
			score: 101,
			sortOrder: -1,
			actions: [
				{
					id: 'bangs.my.new-custom.create',
					label: 'New custom bang',
					safeForEnter: true,
					run: openNewCustomBangEditor
				}
			]
		};
	}

	function getExtendedBangLauncherItems(): LauncherItem[] {
		const provider = settings.bangProvider;
		const providerLabel = bangProviderLabels[provider];

		if (loadedExtendedBangProvider === provider) {
			return hasBangFilter
				? createBangLauncherItems(extendedProviderBangResults.items, 'extended')
				: createBangLauncherItemsFromBangs(
						extendedProviderBangs.slice(
							0,
							getBangGroupRequestedItemCount('bangs.extended', extendedProviderBangCount)
						),
						'extended'
					);
		}

		if (loadingExtendedBangProvider === provider) {
			return [
				{
					id: `bangs.extended.${provider}.loading`,
					pluginId: 'bangs',
					kind: 'insight',
					title: `Loading extended ${providerLabel} bangs`,
					score: 100
				}
			];
		}

		if (extendedBangLoadError && extendedBangLoadErrorProvider === provider) {
			return [
				{
					id: `bangs.extended.${provider}.error`,
					pluginId: 'bangs',
					kind: 'action',
					title: `Could not load extended ${providerLabel} bangs`,
					description: extendedBangLoadError,
					selectionKey: `bangs:extended:${provider}:error`,
					score: 100,
					actions: [
						{
							id: `bangs.extended.${provider}.retry`,
							label: 'Retry',
							safeForEnter: true,
							run: async () => {
								await loadExtendedBangCatalog(provider);
							}
						}
					]
				}
			];
		}

		return [
			{
				id: `bangs.extended.${provider}.load`,
				pluginId: 'bangs',
				kind: 'action',
				title: `Load extended ${providerLabel} bangs`,
				description: 'Load long-tail bangs for this session.',
				selectionKey: `bangs:extended:${provider}:load`,
				score: 100,
				actions: [
					{
						id: `bangs.extended.${provider}.load.primary`,
						label: 'Load extended bangs',
						safeForEnter: true,
						run: async () => {
							await loadExtendedBangCatalog(provider);
						}
					}
				]
			}
		];
	}

	function getBangItemActions(
		item: ZbangRecord,
		source: BangLauncherItemSource,
		itemId: string
	): [LauncherItemAction, ...LauncherItemAction[]] {
		if (mode.id === 'bangs') {
			if (source === 'my') {
				return [
					getBangEditAction(item, itemId, true),
					getBangShareAction(item, itemId),
					getBangMembershipAction(item, source, itemId),
					getBangDefaultSearchAction(item, itemId)
				];
			}

			return [
				getBangMembershipAction(item, source, itemId),
				getBangAddAndEditAction(item, itemId),
				getBangDefaultSearchAction(item, itemId)
			];
		}

		const insertAction: LauncherItemAction = {
			id: `${itemId}.insert`,
			label: `Insert ${item.name}`,
			title: getBangInsertActionTitle(item),
			safeForEnter: true,
			run: () => insertBang(item.code[0])
		};

		if (source === 'my') {
			return [
				insertAction,
				getBangEditAction(item, itemId),
				getBangShareAction(item, itemId),
				getBangMembershipAction(item, source, itemId),
				getBangDefaultSearchAction(item, itemId)
			];
		}

		return [
			insertAction,
			getBangMembershipAction(item, source, itemId),
			getBangDefaultSearchAction(item, itemId)
		];
	}

	function getBangEditAction(
		item: ZbangRecord,
		itemId: string,
		safeForEnter = false
	): LauncherItemAction {
		return {
			id: `${itemId}.edit`,
			label: 'Edit',
			title: `Edit ${item.name}`,
			safeForEnter,
			run: () => openMyBangEditor(item)
		};
	}

	function getBangShareAction(item: ZbangRecord, itemId: string): LauncherItemAction {
		const draft = getSharedMyBangDraft(item);

		return {
			id: `${itemId}.share`,
			label: 'Share',
			title: `Copy share URL for ${item.name}`,
			href: getMyBangShareHref(draft),
			run: () => copyMyBangShareUrlToClipboard(draft)
		};
	}

	function getSharedMyBangDraft(item: ZbangRecord): SharedMyBangDraft {
		return {
			name: item.name,
			code: item.code.map(normalizeBangCode),
			urlTemplate: item.urls.s
		};
	}

	function getBangMembershipAction(
		item: ZbangRecord,
		source: BangLauncherItemSource,
		itemId: string
	): LauncherItemAction {
		return {
			id: `${itemId}.membership`,
			label: getBangMembershipActionLabel(source),
			run: () => updateBangMembership(item, source)
		};
	}

	function getBangAddAndEditAction(item: ZbangRecord, itemId: string): LauncherItemAction {
		return {
			id: `${itemId}.add-edit`,
			label: 'Add and edit copy',
			title: `Add ${item.name} to My Bangs and edit it`,
			run: () => addAndEditMyBang(item)
		};
	}

	function getBangDefaultSearchAction(item: ZbangRecord, itemId: string): LauncherItemAction {
		return {
			id: `${itemId}.set-default`,
			label: 'Set as default',
			title: `Use ${item.name} for default web searches`,
			run: () => setBangAsDefaultSearch(item)
		};
	}

	function getBangMembershipActionLabel(source: BangLauncherItemSource) {
		return source === 'my' ? 'Remove from My Bangs' : 'Add to My Bangs';
	}

	async function updateBangMembership(item: ZbangRecord, source: BangLauncherItemSource) {
		if (source === 'my') {
			await removeMyBang(item);
			return;
		}

		await addMyBang(item);
	}

	function getBangInsertActionTitle(item: ZbangRecord) {
		const code = item.code[0] ? normalizeBangCode(item.code[0]) : '';

		return ['Insert', item.name, 'bang', code].filter(Boolean).join(' ');
	}

	function getBangSelectionKey(item: ZbangRecord) {
		return [
			'bang',
			item.rank,
			item.name,
			item.urls.s,
			item.code.map(normalizeBangCode).join('|')
		].join(':');
	}

	function createBangLauncherItemsFromBangs(items: ZbangRecord[], source: BangLauncherItemSource) {
		return createBangLauncherItems(
			items.map((item, index) => ({
				item,
				score: 100 - index,
				highlights: {
					name: [{ text: item.name, matched: false }],
					code: item.code.map((code) => ({
						segments: [{ text: displayBangCode(code), matched: false }]
					})),
					url: [{ text: item.urls.s, matched: false }]
				}
			})),
			source
		);
	}

	function getBangItemDescription(item: ZbangRecord) {
		return formatBangCodes(item.code.slice(0, 2));
	}

	function getBangMenuInfo(item: ZbangRecord, highlights: BangFilterResult['highlights']) {
		return {
			id: `${item.code[0] ?? item.rank}.details`,
			details: [
				{
					value: formatBangCodes(item.code),
					segments: getBangCodeSegments(getDisplayBangCodeHighlights(highlights.code))
				},
				{
					value: item.urls.s,
					segments: highlights.url
				}
			]
		};
	}

	function createModeListItem(
		mode: LauncherMode,
		score: number,
		shortcutIndex: number,
		sortOrder?: number,
		overrides: Partial<LauncherItem> = {}
	): LauncherItem {
		return {
			id: `mode-list.${mode.id}`,
			pluginId: 'mode-list',
			kind: 'action',
			title: mode.label,
			description: mode.description,
			score,
			sortOrder,
			actions: [
				{
					id: `mode-list.${mode.id}.primary`,
					label: mode.label,
					safeForEnter: shortcutIndex === 0,
					run: () => goto(resolve(mode.path))
				}
			],
			...overrides
		};
	}

	function getFuzzyHighlightSegments(target: string, result: Fuzzysort.Result | null) {
		if (!result?.indexes.length) return [{ text: target, matched: false }];

		const matchedIndexes = new Set(result.indexes);
		const segments: BangHighlightSegment[] = [];
		let current = '';
		let currentMatched = matchedIndexes.has(0);

		for (let index = 0; index < target.length; index += 1) {
			const matched = matchedIndexes.has(index);

			if (matched !== currentMatched) {
				if (current) segments.push({ text: current, matched: currentMatched });
				current = '';
				currentMatched = matched;
			}

			current += target[index];
		}

		if (current) segments.push({ text: current, matched: currentMatched });

		return segments;
	}

	function getCompromiseItems(context: LauncherContext): LauncherItem[] {
		const { nlp: signals } = context;
		const contacts = [...signals.emails, ...signals.phoneNumbers];
		const values = unique([...signals.percentages, ...signals.fractions]).filter(
			(value) => !signals.money.includes(value)
		);
		const social = [...signals.hashTags, ...signals.atMentions];
		const emoji = [...signals.emojis, ...signals.emoticons];
		const keywords = signals.keywords.map(({ word }) => word);

		if (!context.hasValue) {
			return [
				{
					id: 'compromise.empty',
					pluginId: 'compromise',
					kind: 'insight',
					title: 'NLP inspector',
					description: 'Enter text to inspect NLP signals for launcher ranking.',
					score: 50
				}
			];
		}

		return [
			createInsightItem('summary', 'NLP summary', getSummaryDescription(signals), 64),
			createInsightItem('urls', 'URLs', formatList(signals.urls), scoreInsight(59, signals.urls)),
			createInsightItem('contacts', 'Contacts', formatList(contacts), scoreInsight(58, contacts)),
			createInsightItem(
				'currencies',
				'Currencies',
				formatList(signals.currencies),
				scoreInsight(57, signals.currencies)
			),
			createInsightItem(
				'money',
				'Money',
				formatList(signals.money),
				scoreInsight(58, signals.money)
			),
			createInsightItem(
				'keywords',
				'Keywords',
				formatList(keywords),
				scoreInsight(49, keywords, getKeywordScoreBoost(signals.keywords))
			),
			createInsightItem(
				'topics',
				'Topics',
				formatList(signals.topics),
				scoreInsight(48, signals.topics)
			),
			createInsightItem(
				'people',
				'People',
				formatList(signals.people),
				scoreInsight(54, signals.people)
			),
			createInsightItem(
				'places',
				'Places',
				formatList(signals.places),
				scoreInsight(52, signals.places)
			),
			createInsightItem(
				'organizations',
				'Organizations',
				formatList(signals.organizations),
				scoreInsight(53, signals.organizations)
			),
			createInsightItem(
				'questions',
				'Questions',
				formatList(signals.questions),
				scoreInsight(56, signals.questions)
			),
			createInsightItem(
				'dates',
				'Dates',
				formatList(signals.dates),
				scoreInsight(55, signals.dates)
			),
			createInsightItem(
				'times',
				'Times',
				formatList(signals.times),
				scoreInsight(54, signals.times)
			),
			createInsightItem(
				'durations',
				'Durations',
				formatList(signals.durations),
				scoreInsight(53, signals.durations)
			),
			createInsightItem('values', 'Values', formatList(values), scoreInsight(57, values)),
			createInsightItem('social', 'Social', formatList(social), scoreInsight(47, social)),
			createInsightItem(
				'quoted',
				'Quoted text',
				formatList(signals.quotations),
				scoreInsight(55, signals.quotations)
			),
			createInsightItem(
				'verbs',
				'Verbs',
				formatList(signals.verbs),
				scoreInsight(40, signals.verbs)
			),
			createInsightItem(
				'nouns',
				'Nouns',
				formatList(signals.nouns),
				scoreInsight(41, signals.nouns)
			),
			createInsightItem(
				'acronyms',
				'Acronyms',
				formatList(signals.acronyms),
				scoreInsight(46, signals.acronyms)
			),
			createInsightItem(
				'hyphenated',
				'Hyphenated',
				formatList(signals.hyphenated),
				scoreInsight(44, signals.hyphenated)
			),
			createInsightItem(
				'parentheses',
				'Parentheses',
				formatList(signals.parentheses),
				scoreInsight(43, signals.parentheses)
			),
			createInsightItem('emoji', 'Emoji', formatList(emoji), scoreInsight(42, emoji)),
			createInsightItem(
				'terms',
				'Terms',
				formatList(signals.terms),
				scoreInsight(40, signals.terms)
			)
		];
	}

	function createInsightItem(
		id: string,
		title: string,
		description: string,
		score: number
	): LauncherItem {
		return {
			id: `compromise.${id}`,
			pluginId: 'compromise',
			kind: 'insight',
			title,
			description,
			score
		};
	}

	function getSummaryDescription(signals: CompromiseSignals) {
		const counts = [
			`${signals.terms.length} terms`,
			`${signals.topics.length} topics`,
			`${signals.people.length} people`,
			`${signals.places.length} places`,
			`${signals.organizations.length} orgs`,
			`${signals.questions.length} questions`,
			`${signals.urls.length} urls`,
			`${signals.emails.length + signals.phoneNumbers.length} contacts`,
			`${signals.money.length} money`,
			`${signals.currencies.length} currencies`,
			`${signals.dates.length} dates`,
			`${signals.durations.length} durations`,
			`${signals.keywords.length} keywords`
		];

		return counts.join(' | ');
	}

	function formatList(values: string[]) {
		return values.length ? values.join(', ') : 'None detected';
	}

	function formatCount(count: number) {
		return countFormatter.format(count);
	}

	function getBangDescriptionSegments({ code }: BangFilterResult['highlights']) {
		return getBangCodeSegments(getDisplayBangCodeHighlights(code.slice(0, 2)));
	}

	function getBangCodeSegments(code: BangFilterResult['highlights']['code']) {
		const segments: BangHighlightSegment[] = [];

		for (const [index, codeHighlight] of code.entries()) {
			if (index) segments.push({ text: ' ', matched: false });
			segments.push(...codeHighlight.segments);
		}

		return segments;
	}

	function getDisplayBangCodeHighlights(code: BangFilterResult['highlights']['code']) {
		return code.map((codeHighlight) => {
			let strippedBang = false;

			return {
				segments: codeHighlight.segments.flatMap((segment) => {
					if (strippedBang || !segment.text.startsWith('!')) return [segment];

					strippedBang = true;
					const text = segment.text.slice(1);

					return text ? [{ ...segment, text }] : [];
				})
			};
		});
	}

	function formatItemMeta(item: LauncherItem) {
		if (item.pluginId === 'settings') return '';
		if (item.pluginId === 'bang-data') return '';
		if (item.pluginId === 'history') return '';
		if (item.pluginId === 'journal') return '';
		if (item.pluginId === 'journal-entry') return '';
		if (item.pluginId === 'journal-history') return '';

		return [item.pluginId, item.rank ? `rank ${formatCount(item.rank)}` : undefined, item.score]
			.filter(Boolean)
			.join(' | ');
	}
</script>

<svelte:document
	onmousedown={handleDocumentMouseDown}
	onvisibilitychange={handleVisibilityChange}
/>

{#snippet highlightedText(segments: BangHighlightSegment[] | undefined, fallback: string)}
	{#if segments}
		{#each segments as segment, index (`${index}-${segment.text}-${segment.matched}`)}
			{#if segment.kind === 'bang-code'}
				<code class:match-highlight={segment.matched} class="bang-code">{segment.text}</code>
			{:else}
				<span class={segment.matched ? 'match-highlight' : undefined}>{segment.text}</span>
			{/if}
		{/each}
	{:else}
		{fallback}
	{/if}
{/snippet}

{#snippet actionItem(item: LauncherItem, shortcutLabel: string | undefined)}
	{@const itemShortcutLabel = item.pluginId === 'bang-data' ? undefined : shortcutLabel}
	{@const isFocused = item.id === primaryLauncherItem?.id}
	{@const focusedTarget =
		isFocused && primaryLauncherTarget?.kind === 'item' ? primaryLauncherTarget : undefined}
	{@const stagedMenu = stagedActionMenu?.target.id === item.id ? stagedActionMenu : undefined}
	{#if item.pluginId === 'bang-data'}
		{@render notificationItem(item)}
	{:else}
		{@render compactActionItem(item, itemShortcutLabel, focusedTarget, stagedMenu)}
	{/if}
{/snippet}

{#snippet compactActionItem(
	item: LauncherItem,
	itemShortcutLabel: string | undefined,
	focusedTarget: PrimaryLauncherTarget | undefined,
	stagedMenu: StagedActionMenu | undefined
)}
	{@const itemTarget = getCompactActionTarget(item, focusedTarget, stagedMenu)}
	{@const rowActive = Boolean(focusedTarget || stagedMenu)}
	{@const alwaysShowBangDescription = item.pluginId === 'bangs'}
	{@const primaryAction = getPrimaryAction(itemTarget)}
	{@const primaryActionArmed = rowActive && !stagedMenu && Boolean(primaryAction)}
	<div
		class:has-staged-menu={Boolean(stagedMenu)}
		class:journal-entry-item={item.pluginId === 'journal-entry'}
		class:journal-history-item={item.pluginId === 'journal-history'}
		class:primary={item.id === primaryLauncherItem?.id}
		class="launcher-item action-item compact-action-item"
		use:trackLauncherTarget={item.id}
	>
		<button
			class:active-action={rowActive}
			class="item-run compact-action-primary"
			disabled={!primaryAction}
			onclick={() => runTargetAction(primaryAction, itemTarget)}
		>
			<span class="item-text">
				<span class="item-heading">
					{#if item.pluginId === 'settings'}
						<svg
							class:checked={item.selected}
							class="radio-indicator"
							viewBox="0 0 16 16"
							aria-hidden="true"
						>
							<circle class="radio-ring" cx="8" cy="8" r="6" />
							<circle class="radio-dot" cx="8" cy="8" r="3" />
						</svg>
					{/if}
					<strong>{@render highlightedText(item.titleSegments, item.title)}</strong>
				</span>
				<span
					class:bang-description={item.pluginId === 'bangs'}
					class:compact-action-hidden={(!alwaysShowBangDescription && !rowActive) ||
						!item.description}
					class="compact-action-description"
				>
					{#if item.description}{@render highlightedText(
							item.descriptionSegments,
							item.description
						)}{/if}
				</span>
			</span>
			<span class="compact-action-shortcuts">
				{#if primaryActionArmed}<span class="shortcut-label enter-shortcut-label">↵</span>{/if}
			</span>
		</button>

		{@render compactActionMenuToggle(itemTarget, itemShortcutLabel, stagedMenu, rowActive)}
		{@render compactActionMenu(itemTarget, stagedMenu, rowActive)}
	</div>
{/snippet}

{#snippet compactGroupHeader(
	group: LauncherGroup,
	shortcutLabel: string | undefined,
	focusedTarget: PrimaryLauncherTarget | undefined,
	stagedMenu: StagedActionMenu | undefined
)}
	{@const groupTarget = stagedMenu?.target ?? focusedTarget ?? createSelectableGroupTarget(group)}
	{@const rowActive = Boolean(focusedTarget || stagedMenu)}
	{@const primaryAction = getPrimaryAction(groupTarget)}
	{@const primaryActionEffective = isGroupPrimaryActionEffective(group)}
	{@const primaryActionArmed =
		rowActive && primaryActionEffective && !stagedMenu && Boolean(primaryAction)}
	{@const countLabel = getGroupCountLabel(group)}
	{@const countTitle = getGroupCountTitle(group)}
	{@const rangeLabel = getGroupRangeLabel(group)}
	{@const rangeTitle = getGroupRangeTitle(group)}
	<div
		class:has-staged-menu={Boolean(stagedMenu)}
		class:primary={primaryLauncherTarget?.kind === 'group' && primaryLauncherTarget.id === group.id}
		class="launcher-item action-item compact-action-item compact-group-header"
		use:trackLauncherTarget={group.id}
	>
		<button
			class:active-action={rowActive}
			class="item-run compact-action-primary"
			disabled={!primaryAction}
			onclick={() => runTargetAction(primaryAction, groupTarget)}
		>
			<span class="item-text">
				<span class="item-heading">
					<span class="group-title-line" id={`${group.id}-heading`}>
						<strong>{@render highlightedText(group.titleSegments, group.title)}</strong
						>{#if group.titleValue}:
							<span class="group-title-value"
								>{@render highlightedText(group.titleValueSegments, group.titleValue)}</span
							>{/if}
						{#if countLabel}
							<span class="group-count-badge" title={countTitle}>{countLabel}</span>
						{/if}
						{#if rangeLabel}
							<span class="group-range-badge" title={rangeTitle}>{rangeLabel}</span>
						{/if}
					</span>
				</span>
				<span
					class:compact-action-hidden={!group.description}
					class:compact-action-invisible={!rowActive && Boolean(group.description)}
					class="compact-action-description group-description"
				>
					{#if group.description}{@render highlightedText(
							group.descriptionSegments,
							group.description
						)}{/if}
				</span>
			</span>
			<span class="compact-action-shortcuts">
				{#if primaryActionArmed}<span class="shortcut-label enter-shortcut-label">↵</span>{/if}
			</span>
		</button>

		{@render compactActionMenuToggle(groupTarget, shortcutLabel, stagedMenu, rowActive)}
		{@render compactActionMenu(groupTarget, stagedMenu, rowActive)}
	</div>
{/snippet}

{#snippet compactActionMenuToggle(
	target: PrimaryLauncherTarget | undefined,
	rootShortcutLabel: string | undefined,
	menu: StagedActionMenu | undefined,
	rowActive = true
)}
	{#if target}
		{@const hasMenuContent = target.actions.length > 1}
		{@const showShortcutCell = Boolean(rootShortcutLabel || (rowActive && hasMenuContent))}
		{#if showShortcutCell}
			{#if hasMenuContent}
				<button
					class:open={Boolean(menu)}
					class="target-action-menu-item menu-action compact-action-menu-item compact-action-toggle-cell"
					aria-expanded={Boolean(menu)}
					aria-label={`${menu ? 'Close' : 'Open'} options for ${target.title}`}
					onpointerdown={(event) => event.preventDefault()}
					onclick={() => toggleTargetActionMenuFromAffordance(target, rootShortcutLabel, menu)}
				>
					<span class="compact-menu-toggle-icon" aria-hidden="true"></span>
					{#if rootShortcutLabel}
						<span
							class:disabled={!rowActive && isItemShortcutLabelDisabled(rootShortcutLabel)}
							class:inactive-compact-shortcut={!rowActive}
							class="shortcut-label pseudo-menu-shortcut-badge">{rootShortcutLabel}</span
						>
					{:else}
						<span
							class="shortcut-label pseudo-menu-shortcut-badge compact-action-invisible"
							aria-hidden="true">{itemShortcutLabels[0]}</span
						>
					{/if}
				</button>
			{:else if rootShortcutLabel}
				<span
					class="target-action-menu-item compact-action-menu-item compact-action-toggle-cell compact-action-shortcut-cell"
					aria-label={`Shortcut ${rootShortcutLabel} for ${target.title}`}
				>
					<span class="compact-menu-toggle-icon compact-action-invisible" aria-hidden="true"></span>
					<span
						class:disabled={!rowActive && isItemShortcutLabelDisabled(rootShortcutLabel)}
						class:inactive-compact-shortcut={!rowActive}
						class="shortcut-label pseudo-menu-shortcut-badge">{rootShortcutLabel}</span
					>
				</span>
			{/if}
		{/if}
	{/if}
{/snippet}

{#snippet compactActionMenu(
	target: PrimaryLauncherTarget | undefined,
	menu: StagedActionMenu | undefined,
	rowActive = true
)}
	{#if target && menu}
		{@const armedAction = getStagedActionMenuArmedAction(menu)}
		<div
			class="target-action-menu compact-action-menu full"
			class:active-action={rowActive}
			role="menu"
			aria-label={`Options for ${target.title}`}
		>
			{#each menu.actions as action, index (action.id)}
				{@const shortcutLabel = getActionMenuShortcutLabel(menu, index)}
				{#if action.kind === 'info'}
					<div
						class="target-action-menu-item staged-action-menu-info compact-action-menu-item"
						role="presentation"
					>
						<span class="staged-action-menu-info-details">
							{#each action.details as detail (detail.value)}
								<span class="staged-action-menu-info-value"
									>{@render highlightedText(detail.segments, detail.value)}</span
								>
							{/each}
						</span>
					</div>
				{:else}
					{@const actionArmed = action.id === armedAction?.id}
					{#if action.href}
						<a
							class:armed={actionArmed}
							class="target-action-menu-item staged-action-menu-item compact-action-menu-item"
							href={resolve(action.href)}
							role="menuitem"
							onclick={(event) => runStagedActionMenuAction(action, event)}
						>
							{@render stagedActionMenuActionContent(action, actionArmed, shortcutLabel)}
						</a>
					{:else}
						<button
							class:armed={actionArmed}
							class="target-action-menu-item staged-action-menu-item compact-action-menu-item"
							role="menuitem"
							onpointerdown={(event) => event.preventDefault()}
							onclick={() => runStagedActionMenuAction(action)}
						>
							{@render stagedActionMenuActionContent(action, actionArmed, shortcutLabel)}
						</button>
					{/if}
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet stagedActionMenuActionContent(
	action: LauncherRunnableAction,
	actionArmed: boolean,
	shortcutLabel: string | undefined
)}
	<span class="staged-action-menu-label">{action.title ?? action.label}</span>
	<span class="compact-action-enter-slot">
		{#if actionArmed}<span class="shortcut-label enter-shortcut-label">↵</span>{:else}<span
				class="shortcut-label enter-shortcut-label compact-action-invisible"
				aria-hidden="true">↵</span
			>{/if}
	</span>
	<span class="compact-action-menu-shortcut-slot">
		{#if shortcutLabel}<span
				class="shortcut-label menu-select-shortcut-label"
				title={`Select ${action.title ?? action.label}`}>{shortcutLabel}</span
			>{:else}<span
				class="shortcut-label menu-select-shortcut-label compact-action-invisible"
				aria-hidden="true">{itemShortcutLabels[0]}</span
			>{/if}
	</span>
{/snippet}

{#snippet insightItem(item: LauncherItem)}
	<article class="launcher-item insight-item">
		<span class="item-text">
			<span class="item-heading">
				<strong>{@render highlightedText(item.titleSegments, item.title)}</strong>
			</span>
			{#if item.description}<small
					>{@render highlightedText(item.descriptionSegments, item.description)}</small
				>{/if}
		</span>
		<span class="meta">{formatItemMeta(item)}</span>
	</article>
{/snippet}

{#snippet notificationItem(item: LauncherItem)}
	<article
		class:primary={item.id === primaryLauncherItem?.id}
		class="launcher-item notification-item"
		use:trackLauncherTarget={item.id}
	>
		<span class="item-text">
			<span class="item-heading">
				<strong>{@render highlightedText(item.titleSegments, item.title)}</strong>
			</span>
			{#if item.description}<small
					>{@render highlightedText(item.descriptionSegments, item.description)}</small
				>{/if}
		</span>
	</article>
{/snippet}

{#snippet launcherGroup(group: LauncherGroup)}
	{@const renderedItems = getRenderedGroupItems(group)}
	{@const shortcutLabel = getShortcutLabel(group.id)}
	{@const isFocusedGroup =
		primaryLauncherTarget?.kind === 'group' && primaryLauncherTarget.id === group.id}
	{@const focusedTarget = isFocusedGroup ? primaryLauncherTarget : undefined}
	{@const stagedMenu = stagedActionMenu?.target.id === group.id ? stagedActionMenu : undefined}
	<section class="launcher-group" aria-labelledby={`${group.id}-heading`}>
		{@render compactGroupHeader(group, shortcutLabel, focusedTarget, stagedMenu)}

		<div class="launcher-group-items">
			{#each renderedItems as item (item.id)}
				{#if item.kind === 'action'}
					{@const shortcutLabel = getShortcutLabel(item.id)}
					{@render actionItem(item, shortcutLabel)}
				{:else}
					{@render insightItem(item)}
				{/if}
			{/each}
		</div>
	</section>
{/snippet}

<main>
	<Header modeLabel={mode.label} />

	<div class="launcher-input-shell">
		<ExpandingTextarea
			bind:textareaElement
			bind:value
			displayValue={inputDisplayValue}
			countValue={bangComposition.hasTargets || Boolean(bangEntry)
				? bangComposition.payloadCountText
				: undefined}
			previewSegments={inputPreviewSegments}
			statusHint={stagedShortcutStatusHint}
			tokenCount={inputTokenCount}
			bind:fullscreen
			bind:wordwrap
			bind:enterNewlineRestored
			bind:enterNewlineFullscreen
			autofocus
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"
			placeholder={textareaPlaceholder}
			onblur={handleLauncherBlur}
			onbeforeinput={handleLauncherBeforeInput}
			onclick={handleLauncherCursorChange}
			oninput={handleLauncherInput}
			onkeydown={handleLauncherKeydown}
			onkeyup={handleLauncherKeyup}
			onprimaryaction={runPrimaryAction}
		>
			{#snippet primaryAction()}
				{#if fullscreen && primaryLauncherItem}
					{@render actionItem(primaryLauncherItem, getShortcutLabel(primaryLauncherItem.id))}
				{/if}
			{/snippet}
		</ExpandingTextarea>
	</div>

	{#if bangComposition.hasTargets}
		<div class="bang-composition" aria-label="Bang composition preview">
			{#each bangComposition.localTargets as target, index (`local-${index}-${target.token}`)}
				<span class="composition-chip target-chip">{target.item.name}</span>
			{/each}
			{#each bangComposition.forwardedTokens as token, index (`forwarded-${index}-${token}`)}
				<span class="composition-chip forwarded-chip"
					>{token} via {searchProviderLabels[settings.searchProvider]}</span
				>
			{/each}
		</div>
	{/if}

	{#if bangFanoutError}
		<section class="bang-fanout-message" aria-live="polite">
			<div>
				<strong>Popups may be blocked</strong>
				<p>
					{bangFanoutError} Use the popup-blocked icon in the address bar to allow popups, then retry
					the bang search.
				</p>
			</div>
			{#if bangFanoutTargets.length}
				<ol>
					{#each bangFanoutTargets as targetUrl, index (`${index}-${targetUrl}`)}
						<li>
							<a {...getBangFanoutLinkAttributes(targetUrl)} class="bang-fanout-target">
								{bangFanoutActionLabel}
								{getBangFanoutTargetLabel(targetUrl)}
							</a>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}

	<section class="launcher-list" aria-label="Launcher actions and insights">
		{#if secondaryLauncherItems.length}
			<div class="launcher-group-items launcher-standalone-items">
				{#each secondaryLauncherItems as item (item.id)}
					{#if item.kind === 'action'}
						{@const shortcutLabel = getShortcutLabel(item.id)}
						{@render actionItem(item, shortcutLabel)}
					{:else}
						{@render insightItem(item)}
					{/if}
				{/each}
			</div>
		{/if}
		{#each visibleLauncherGroups as group (group.id)}
			{@render launcherGroup(group)}
		{/each}
	</section>
</main>

{#if myBangEditor}
	<MyBangEditor
		session={myBangEditor}
		{myBangs}
		{providerBangs}
		getShareHref={getMyBangShareHref}
		onSave={saveMyBangDraft}
		onShare={copyMyBangShareUrlToClipboard}
		onCancel={closeMyBangEditor}
		onDelete={deleteMyBang}
	/>
{/if}

{#if journalEntryEditor}
	<JournalEntryEditor
		session={journalEntryEditor}
		onSave={saveJournalEntryDraft}
		onCancel={closeJournalEntryEditor}
		onDelete={deleteManualJournalEntry}
	/>
{/if}

<style>
	main {
		width: min(calc(var(--nc-content-width) + 2 * var(--nc-spacing)), 100%);
		margin-inline: auto;
		padding-inline: var(--nc-spacing);
		padding-block-end: var(--size-4);
	}

	.launcher-input-shell {
		position: sticky;
		top: 0;
		z-index: 2;
		padding-block-start: var(--size-1);
		background: var(--nc-surface-1);
	}

	.launcher-list {
		--launcher-group-gap: var(--size-3);
		--launcher-list-bg: color-mix(in srgb, var(--nc-surface-1) 84%, var(--nc-surface-2));
		--launcher-list-border: color-mix(in srgb, var(--nc-border) 72%, transparent);
		--launcher-list-divider: color-mix(in srgb, var(--nc-border) 58%, transparent);
		--launcher-row-hover-bg: color-mix(in srgb, var(--nc-primary) 5%, transparent);
		--launcher-row-active-bg: color-mix(in srgb, var(--nc-primary) 9%, transparent);
		--launcher-row-active-rail: color-mix(in srgb, var(--nc-primary) 70%, transparent);

		display: grid;
		gap: var(--launcher-group-gap);
		margin-block-start: var(--size-3);
	}

	.target-action-menu {
		display: grid;
		gap: 0;
		min-width: 0;
	}

	.target-action-menu-item {
		display: grid;
		grid-template-columns: 1.45rem minmax(0, 1fr);
		align-items: center;
		gap: var(--size-1);
		width: 100%;
		min-width: 0;
		margin: 0;
		padding: 0.35rem 0.6rem;
		color: var(--nc-tx-1);
		background: transparent;
		border: 0;
		border-radius: 0;
		font-size: var(--font-size-0);
		font-weight: 700;
		line-height: 1.2;
		text-align: left;
		text-decoration: none;
		box-shadow: none;
	}

	.target-action-menu-item span:last-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.target-action-menu-item:hover,
	.target-action-menu-item:focus {
		background: var(--launcher-row-hover-bg);
		box-shadow: none;
	}

	.staged-action-menu-item {
		grid-template-columns: 1.45rem minmax(0, 1fr) auto;
		background: transparent;
	}

	.compact-action-menu-shortcut-slot,
	.compact-action-enter-slot {
		display: inline-grid;
		place-items: center;
		min-width: 1.45rem;
		justify-self: end;
	}

	.target-action-menu-item .shortcut-label {
		margin-inline: 0;
	}

	.staged-action-menu-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.staged-action-menu-info {
		grid-template-columns: minmax(0, 1fr);
		color: var(--nc-tx-2);
		cursor: default;
		font-weight: 500;
	}

	.target-action-menu-item.staged-action-menu-info:hover,
	.target-action-menu-item.staged-action-menu-info:focus {
		background: transparent;
	}

	.target-action-menu-item.staged-action-menu-info span:last-child {
		overflow: visible;
		text-overflow: clip;
		white-space: normal;
	}

	.staged-action-menu-info-details {
		display: grid;
		gap: 0.25rem;
		min-width: 0;
	}

	.staged-action-menu-info-value {
		min-width: 0;
		overflow-wrap: anywhere;
		font-family: var(--font-mono), monospace;
		font-size: calc(var(--font-size-0) * 0.82);
		line-height: 1.35;
	}

	.enter-shortcut-label {
		justify-self: end;
	}

	.staged-action-menu-item.armed {
		color: var(--nc-tx-1);
		background: color-mix(in srgb, var(--nc-primary) 20%, transparent);
		box-shadow:
			inset 0.22rem 0 0 var(--launcher-row-active-rail),
			inset 0 0 0 1px color-mix(in srgb, var(--nc-primary) 30%, transparent);
	}

	.staged-action-menu-item.armed .staged-action-menu-label {
		color: var(--nc-tx-1);
	}

	.staged-action-menu-item.armed .enter-shortcut-label {
		color: var(--nc-tx-1);
		background: color-mix(in srgb, var(--nc-primary) 24%, var(--nc-surface-2));
		border-color: color-mix(in srgb, var(--nc-primary) 78%, var(--nc-border));
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 58%, transparent),
			0 1px 3px color-mix(in srgb, var(--nc-primary) 28%, transparent);
	}

	.menu-select-shortcut-label {
		color: var(--nc-tx-2);
		background: color-mix(in srgb, var(--nc-surface-2) 72%, transparent);
	}

	.staged-action-menu-item:hover,
	.staged-action-menu-item:focus {
		background: var(--launcher-row-hover-bg);
		box-shadow: none;
	}

	.staged-action-menu-item.armed:hover,
	.staged-action-menu-item.armed:focus {
		background: color-mix(in srgb, var(--nc-primary) 20%, transparent);
		box-shadow:
			inset 0.22rem 0 0 var(--launcher-row-active-rail),
			inset 0 0 0 1px color-mix(in srgb, var(--nc-primary) 30%, transparent);
	}

	.launcher-group {
		display: grid;
		gap: var(--size-1);
	}

	.launcher-group-items {
		display: grid;
		gap: 0;
		overflow: clip;
		background: var(--launcher-list-bg);
		border: 1px solid var(--launcher-list-border);
		border-radius: var(--nc-radius);
	}

	.launcher-group-items > .launcher-item {
		border-radius: 0;
	}

	.launcher-group-items > .insight-item {
		background: transparent;
		border: 0;
		box-shadow: none;
	}

	.launcher-group-items > .launcher-item + .launcher-item {
		border-block-start: 1px solid var(--launcher-list-divider);
	}

	.launcher-group-items > .compact-action-item:hover,
	.launcher-group-items > .compact-action-item:focus-within {
		background: var(--launcher-row-hover-bg);
	}

	.launcher-group-items > .compact-action-item.primary,
	.launcher-group-items > .compact-action-item.has-staged-menu {
		background: var(--launcher-row-active-bg);
	}

	.launcher-group-items > .compact-action-item.journal-entry-item {
		background: color-mix(in srgb, var(--green-2) 32%, var(--launcher-list-bg));
		box-shadow: inset 0.18rem 0 0 color-mix(in srgb, var(--green-7) 72%, transparent);
	}

	.launcher-group-items > .compact-action-item.journal-history-item {
		background: color-mix(in srgb, var(--nc-surface-2) 42%, transparent);
	}

	.group-title-value {
		font-weight: 400;
	}

	.group-title-line {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}

	.group-count-badge,
	.group-range-badge {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		min-height: 1rem;
		padding-inline: 0.35rem;
		color: color-mix(in srgb, var(--nc-tx-2) 86%, transparent);
		background: color-mix(in srgb, var(--nc-surface-2) 72%, transparent);
		border: 1px solid color-mix(in srgb, var(--nc-border) 76%, transparent);
		border-radius: calc(var(--nc-radius) * 0.55);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: normal;
		text-transform: none;
	}

	.bang-composition {
		display: flex;
		flex-wrap: wrap;
		gap: var(--size-1);
		margin-block-start: var(--size-2);
	}

	.composition-chip {
		display: inline-flex;
		align-items: center;
		min-height: 1.75rem;
		padding-inline: 0.625rem;
		border: 1px solid var(--nc-border);
		border-radius: 999px;
		font-size: var(--font-size-0);
		line-height: 1;
	}

	.target-chip {
		color: var(--nc-accent-fg);
		background: var(--nc-accent-bg);
		border-color: color-mix(in oklab, var(--nc-accent-bg), var(--nc-border));
	}

	.forwarded-chip {
		color: var(--nc-tx-1);
		background: var(--nc-surface-2);
	}

	.bang-fanout-message {
		display: grid;
		gap: var(--size-2);
		margin-block-start: var(--size-2);
		padding: var(--size-2) var(--size-3);
		color: var(--nc-tx-1);
		background: color-mix(in srgb, var(--yellow-2) 72%, var(--nc-surface-1));
		border: 1px solid var(--yellow-6);
		border-radius: var(--nc-radius);
	}

	.bang-fanout-message strong,
	.bang-fanout-message p,
	.bang-fanout-message ol {
		margin: 0;
	}

	.bang-fanout-message p {
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
	}

	.bang-fanout-message ol {
		display: flex;
		flex-wrap: wrap;
		gap: var(--size-1);
		padding: 0;
		list-style: none;
	}

	.bang-fanout-target {
		display: inline-flex;
		align-items: center;
		margin: 0;
		padding: 0.2rem 0.5rem;
		color: var(--nc-tx-1);
		background: var(--nc-surface-1);
		border: 1px solid var(--nc-border);
		border-radius: 999px;
		font-size: var(--font-size-0);
		font-weight: 700;
		line-height: 1.2;
		text-decoration: none;
		box-shadow: none;
	}

	.bang-fanout-target:hover,
	.bang-fanout-target:focus {
		background: color-mix(in srgb, var(--nc-primary) 10%, var(--nc-surface-1));
		text-decoration: underline;
		box-shadow: none;
	}

	.launcher-item {
		--buttonBg: var(--nc-surface-1);
		--buttonText: var(--nc-tx-1);

		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--size-3);
		width: 100%;
		margin: 0;
		padding: var(--size-2) var(--size-3);
		text-align: left;
		background: var(--nc-surface-1);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
		color: var(--nc-tx-1);
		transition:
			background-color 120ms ease,
			border-color 120ms ease,
			box-shadow 120ms ease,
			transform 120ms ease;
	}

	.compact-action-item {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(3.5rem, max-content);
		gap: 0;
		padding: 0;
		background: transparent;
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}

	.compact-action-item > .compact-action-menu {
		grid-column: 1 / -1;
		min-width: 0;
	}

	.compact-action-item.has-staged-menu > .compact-action-menu {
		grid-column: 1 / -1;
	}

	.compact-group-header {
		padding-block: 0.15rem;
		background: transparent;
		border-color: transparent;
		color: var(--nc-tx-2);
		box-shadow: none;
	}

	.compact-group-header .compact-action-primary,
	.compact-group-header .compact-action-menu-item {
		color: var(--nc-tx-2);
	}

	.compact-group-header .item-heading {
		font-size: 0.74rem;
		font-weight: 650;
		letter-spacing: 0.035em;
		text-transform: uppercase;
	}

	.compact-group-header .compact-action-primary .item-text {
		align-items: center;
	}

	.compact-group-header .group-title-value {
		color: color-mix(in srgb, var(--nc-tx-2) 78%, transparent);
		letter-spacing: normal;
		text-transform: none;
	}

	.compact-group-header .group-description {
		font-size: var(--font-size-0);
		line-height: 1;
	}

	.item-run {
		display: grid;
		grid-template-columns: 1.45rem minmax(0, 1fr) auto;
		align-items: center;
		gap: var(--size-2);
		flex: 1 1 auto;
		min-width: 0;
		margin: 0;
		padding: 0;
		color: inherit;
		text-align: left;
		background: transparent;
		border: none;
		box-shadow: none;
	}

	.item-run:hover,
	.item-run:focus {
		background: transparent;
		box-shadow: none;
	}

	.item-run:disabled {
		color: inherit;
		cursor: default;
		opacity: 1;
	}

	.compact-action-primary,
	.compact-action-menu-item {
		margin: 0;
		min-height: 2rem;
		padding: 0.35rem 0.65rem;
		color: var(--nc-tx-1);
		background: transparent;
		border: 0;
		border-radius: 0;
		line-height: 1.2;
		box-shadow: none;
	}

	.compact-action-primary {
		grid-template-columns: minmax(0, 1fr) auto;
	}

	.compact-action-shortcuts {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.25rem;
	}

	.compact-action-primary.active-action,
	.compact-action-menu.active-action .compact-action-menu-item {
		background: transparent;
		color: var(--nc-tx-1);
	}

	.compact-action-primary.active-action:hover,
	.compact-action-primary.active-action:focus {
		background: transparent;
	}

	.compact-action-menu.full.active-action .compact-action-menu-item:hover,
	.compact-action-menu.full.active-action .compact-action-menu-item:focus {
		background: var(--launcher-row-hover-bg);
	}

	.compact-action-menu.full.active-action .compact-action-menu-item.armed:hover,
	.compact-action-menu.full.active-action .compact-action-menu-item.armed:focus {
		background: color-mix(in srgb, var(--nc-primary) 20%, transparent);
		box-shadow:
			inset 0.22rem 0 0 var(--launcher-row-active-rail),
			inset 0 0 0 1px color-mix(in srgb, var(--nc-primary) 30%, transparent);
	}

	.compact-group-header .compact-action-primary.active-action,
	.compact-group-header .compact-action-menu.active-action .compact-action-menu-item {
		background: transparent;
		border-color: transparent;
		color: inherit;
	}

	.compact-group-header
		.compact-action-menu.full.active-action
		.compact-action-menu-item:not(.armed):hover,
	.compact-group-header
		.compact-action-menu.full.active-action
		.compact-action-menu-item:not(.armed):focus {
		background: var(--launcher-row-hover-bg);
	}

	.compact-action-primary .item-text {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}

	.compact-action-primary .item-heading {
		flex: 0 0 auto;
	}

	.compact-action-primary .item-heading strong {
		overflow: visible;
		text-overflow: clip;
	}

	.compact-action-description {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.compact-action-description.bang-description {
		color: var(--nc-tx-2);
		opacity: 0.72;
	}

	.compact-action-hidden {
		display: none;
	}

	.compact-action-invisible {
		visibility: hidden;
	}

	.compact-action-menu {
		justify-self: end;
		width: max-content;
		max-width: 100%;
		color: var(--nc-tx-2);
	}

	.compact-action-menu.full {
		justify-self: stretch;
		width: 100%;
		border-block-start: 1px solid var(--launcher-list-divider);
	}

	.compact-action-menu-item {
		grid-template-columns: minmax(0, 1fr) auto;
		justify-content: stretch;
		gap: 0.4rem;
		width: 100%;
		max-width: 100%;
		white-space: nowrap;
	}

	.compact-action-toggle-cell {
		grid-template-columns: auto auto;
		justify-content: center;
		justify-items: center;
		align-content: stretch;
		gap: 0.45rem;
		min-width: 3.5rem;
		min-height: 100%;
		padding-inline: 0.5rem 0.65rem;
		color: var(--nc-tx-2);
	}

	.compact-action-toggle-cell:hover,
	.compact-action-toggle-cell:focus {
		background: transparent;
	}

	.compact-action-shortcut-cell {
		cursor: default;
	}

	.compact-action-shortcut-cell:hover,
	.compact-action-shortcut-cell:focus {
		background: transparent;
	}

	.compact-menu-toggle-icon {
		width: 0;
		height: 0;
		border-block-start: 0.28rem solid transparent;
		border-block-end: 0.28rem solid transparent;
		border-inline-start: 0.36rem solid currentColor;
		transition: transform 140ms ease;
	}

	.compact-action-toggle-cell.open .compact-menu-toggle-icon {
		transform: rotate(90deg);
	}

	.compact-action-menu.full .compact-action-menu-item {
		grid-template-columns: minmax(0, 1fr) 2rem minmax(3.5rem, max-content);
		justify-content: stretch;
		padding-inline: 0.65rem;
		width: 100%;
	}

	.compact-action-menu.full .staged-action-menu-info-details {
		grid-column: 1 / -1;
	}

	.compact-action-menu.full .compact-action-menu-item + .compact-action-menu-item {
		border-block-start: 1px solid var(--launcher-list-divider);
	}

	.action-item.primary {
		--buttonBg: color-mix(in srgb, var(--nc-primary) 14%, var(--nc-surface-1));
		--buttonText: var(--nc-tx-1);

		background: color-mix(in srgb, var(--nc-primary) 14%, var(--nc-surface-1));
		border-color: var(--nc-primary);
		box-shadow: 0 0.375rem 1rem color-mix(in srgb, var(--nc-primary) 16%, transparent);
		transform: translateY(-1px);
	}

	.compact-action-item.primary {
		background: var(--launcher-row-active-bg);
		box-shadow: inset 0.18rem 0 0 var(--launcher-row-active-rail);
		transform: none;
	}

	.compact-group-header.primary {
		background: transparent;
		border-color: transparent;
		box-shadow: inset 0.18rem 0 0 var(--launcher-row-active-rail);
	}

	.compact-group-header:hover,
	.compact-group-header:focus-within,
	.compact-group-header.has-staged-menu {
		background: color-mix(in srgb, var(--nc-primary) 3%, transparent);
		border-color: transparent;
		box-shadow: inset 0.18rem 0 0 var(--launcher-row-active-rail);
	}

	.compact-group-header.primary,
	.compact-group-header:hover,
	.compact-group-header:focus-within,
	.compact-group-header.has-staged-menu,
	.compact-group-header.primary .compact-action-primary,
	.compact-group-header:hover .compact-action-primary,
	.compact-group-header:focus-within .compact-action-primary,
	.compact-group-header.has-staged-menu .compact-action-primary {
		color: var(--nc-tx-1);
	}

	.launcher-group .action-item.primary {
		transform: none;
	}

	.notification-item {
		background: color-mix(in srgb, var(--yellow-2) 72%, var(--nc-surface-1));
		border-color: var(--yellow-6);
	}

	.notification-item.primary {
		background: color-mix(in srgb, var(--yellow-3) 78%, var(--nc-surface-1));
		border-color: var(--yellow-7);
		box-shadow: 0 0.375rem 1rem color-mix(in srgb, var(--yellow-6) 20%, transparent);
	}

	.insight-item {
		color: var(--nc-tx-2);
	}

	.item-text {
		flex: 1 1 auto;
		display: grid;
		gap: 0.125rem;
		min-width: 0;
	}

	.item-heading {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		min-width: 0;
	}

	.item-heading strong {
		flex: 1 1 auto;
		display: block;
		min-width: 0;
	}

	.radio-indicator {
		flex: 0 0 auto;
		width: 1rem;
		height: 1rem;
		color: color-mix(in srgb, var(--nc-tx-2) 82%, var(--nc-border));
		overflow: visible;
	}

	.radio-ring {
		fill: var(--nc-surface-1);
		stroke: currentColor;
		stroke-width: 2;
	}

	.radio-dot {
		fill: var(--nc-primary);
		opacity: 0;
	}

	.radio-indicator.checked {
		color: var(--nc-primary);
	}

	.radio-indicator.checked .radio-dot {
		opacity: 1;
	}

	.action-item.primary .radio-ring {
		fill: color-mix(in srgb, var(--nc-primary) 6%, var(--nc-surface-1));
	}

	.shortcut-label {
		display: inline-grid;
		place-items: center;
		min-width: 1.05rem;
		height: 1.05rem;
		padding: 0 0.1875rem;
		margin-inline: 0.125rem;
		font-family: monospace;
		font-size: 0.74rem;
		font-weight: 700;
		line-height: 1;
		color: var(--nc-tx-2);
		background: var(--nc-surface-2);
		border: 1px solid var(--nc-border);
		border-radius: calc(var(--nc-radius) * 0.55);
		box-shadow:
			inset 0 1px 0 color-mix(in srgb, white 52%, transparent),
			0 1px 2px color-mix(in srgb, black 12%, transparent);
	}

	.shortcut-label.disabled {
		color: color-mix(in srgb, var(--nc-tx-2) 58%, transparent);
		background: color-mix(in srgb, var(--nc-surface-2) 48%, transparent);
		border-color: color-mix(in srgb, var(--nc-border) 60%, transparent);
		box-shadow: none;
		opacity: 0.58;
	}

	.action-item.primary .shortcut-label {
		color: var(--nc-primary);
		border-color: color-mix(in srgb, var(--nc-primary) 55%, var(--nc-border));
	}

	.compact-action-menu-item .shortcut-label {
		margin-inline: 0;
	}

	.compact-action-shortcuts .shortcut-label {
		margin-inline: 0;
	}

	.launcher-item strong,
	.launcher-item small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.launcher-item small {
		color: var(--nc-tx-2);
	}

	.match-highlight {
		color: rgb(255 62 0 / 0.76);
		border-radius: 0.2em;
		font-weight: 700;
		padding-inline: 0.08em;
	}

	.bang-code {
		padding: 0.05em 0.3em;
		border-radius: 0.3em;
		background: color-mix(in srgb, var(--nc-primary) 10%, var(--nc-surface-2));
		color: var(--nc-tx-1);
		font-family: var(--font-mono), monospace;
		font-size: 0.9em;
	}

	.meta {
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
		white-space: nowrap;
	}

	@media (max-width: 520px) {
		.launcher-list {
			--launcher-group-gap: var(--size-2);

			margin-block-start: var(--size-2);
		}

		.launcher-item {
			gap: var(--size-2);
			padding: var(--size-1) var(--size-2);
			min-height: 0;
		}

		.compact-action-item {
			gap: 0;
			padding: 0;
		}

		.item-heading {
			gap: var(--size-1);
		}

		.item-run {
			grid-template-columns: 1.45rem minmax(0, 1fr) auto;
			align-items: start;
			gap: 0.125rem var(--size-2);
		}

		.compact-action-primary {
			grid-template-columns: minmax(0, 1fr) auto;
		}

		.compact-action-primary .item-text {
			display: grid;
			gap: 0.125rem;
		}

		.compact-action-menu.full,
		.compact-action-menu.full .compact-action-menu-item {
			width: 100%;
		}

		.group-description {
			display: none;
		}

		.group-range-badge {
			display: none;
		}

		.launcher-item .meta {
			display: none;
		}
	}
</style>
