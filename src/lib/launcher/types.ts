import type { ZbangRecord } from '#lib/bang-data.js';
import type { BangHighlightSegment } from '#lib/bang-filter.js';

export type LauncherHref = `/bang#${string}`;

export type LauncherItemAction = {
	id: string;
	label: string;
	title?: string;
	href?: LauncherHref;
	safeForEnter?: boolean;
	run: () => void | Promise<void>;
};

export type LauncherMenuInfo = {
	id: string;
	details: readonly {
		value: string;
		segments?: BangHighlightSegment[];
	}[];
};

type LauncherItemBase = {
	id: string;
	pluginId: string;
	title: string;
	description?: string;
	titleSegments?: BangHighlightSegment[];
	descriptionSegments?: BangHighlightSegment[];
	selectionKey?: string;
	selected?: boolean;
	rank?: number;
	score: number;
	sortOrder?: number;
};

export type LauncherItem =
	| (LauncherItemBase & {
			kind: 'action';
			actions: readonly [LauncherItemAction, ...LauncherItemAction[]];
			menuInfo?: readonly LauncherMenuInfo[];
	  })
	| (LauncherItemBase & {
			kind: 'insight';
	  });

export type LauncherGroup = {
	id: string;
	pluginId: string;
	title: string;
	titleValue?: string;
	titleValueSegments?: BangHighlightSegment[];
	description?: string;
	titleSegments?: BangHighlightSegment[];
	descriptionSegments?: BangHighlightSegment[];
	items: LauncherItem[];
	allItems?: LauncherItem[];
	availableItemCount?: number;
	actions?: readonly LauncherItemAction[];
	collapsedItemLimit?: number;
	matchedCount?: number;
	totalCount?: number;
};

export type LauncherContext = {
	text: string;
	hasValue: boolean;
	bangComposition: BangComposition;
	nlp: CompromiseSignals;
};

export type LauncherPlugin = {
	id: string;
	getItems?: (context: LauncherContext) => LauncherItem[];
	getGroups?: (context: LauncherContext) => LauncherGroup[];
};

export type LauncherModeId =
	'everything' | 'bangs' | 'compromise' | 'search' | 'settings' | 'history' | 'journal';

export type LauncherMode = {
	id: LauncherModeId;
	label: string;
	description: string;
	path: '/' | '/search' | '/bang' | '/nlp' | '/settings' | '/history' | '/journal';
	pluginIds: readonly string[];
	keywords: readonly string[];
};

export type BangEntry = { triggerIndex: number; fragment: string };

export type BangCompositionTarget = { token: string; item: ZbangRecord };

export type BangComposition = {
	localTargets: BangCompositionTarget[];
	forwardedTokens: string[];
	payloadText: string;
	payloadCountText: string;
	hasTargets: boolean;
};

export type KeywordSignal = { word: string; score: number };

export type CompromiseSignals = {
	terms: string[];
	topics: string[];
	people: string[];
	places: string[];
	organizations: string[];
	questions: string[];
	urls: string[];
	emails: string[];
	phoneNumbers: string[];
	hashTags: string[];
	atMentions: string[];
	emojis: string[];
	emoticons: string[];
	money: string[];
	currencies: string[];
	percentages: string[];
	fractions: string[];
	acronyms: string[];
	hyphenated: string[];
	quotations: string[];
	parentheses: string[];
	keywords: KeywordSignal[];
	dates: string[];
	times: string[];
	durations: string[];
	verbs: string[];
	nouns: string[];
};
