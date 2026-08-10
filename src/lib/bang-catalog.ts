export type BangSourceId = 'duckduckgo' | 'kagi-shared' | 'kagi-kagi';
export type BangProviderId = 'duckduckgo' | 'kagi';
export type BangCatalogVariant = 'popular' | 'extended';

export type BangSourceDefinition = {
	id: BangSourceId;
	label: string;
	url: string;
};

export type PersistedBangSource = {
	id: BangSourceId;
	url: string;
	hash: string;
	bangCount?: number;
	text: string;
};

export type CatalogZbangRecord = {
	popularity: number;
	name: string;
	code: string[];
	tags: string[];
	urls: {
		s: string;
	};
};

export type ZbangRecord = CatalogZbangRecord & {
	rank: number;
};

export type ZbangCatalog = {
	provider: BangProviderId;
	generatorVersion: number;
	dedupedCount?: number;
	sources: Array<Pick<PersistedBangSource, 'url' | 'hash'>>;
	items: CatalogZbangRecord[];
};

export type RankedZbangCatalog = Omit<ZbangCatalog, 'items'> & {
	items: ZbangRecord[];
};

type SourceBangRecord = {
	c?: string;
	d?: string;
	r?: number;
	s?: string;
	sc?: string;
	t?: string;
	ts?: string[];
	u?: string;
};

type KagiBangSourceId = Extract<BangSourceId, 'kagi-shared' | 'kagi-kagi'>;

type NormalizedBang = CatalogZbangRecord & {
	codeRanks: Record<string, number>;
	domains: string[];
};

type DedupeResult = {
	items: NormalizedBang[];
	dedupedCount: number;
};

type DuckDuckGoRank = {
	popularity: number;
	domain: string;
};

const GENERATOR_VERSION = 5;

export const BANG_CATALOG_VARIANTS: BangCatalogVariant[] = ['popular', 'extended'];

export const BANG_SOURCES: BangSourceDefinition[] = [
	{
		id: 'duckduckgo',
		label: 'DuckDuckGo',
		url: 'https://duckduckgo.com/bang.js'
	},
	{
		id: 'kagi-shared',
		label: 'Kagi shared',
		url: 'https://github.com/kagisearch/bangs/raw/refs/heads/main/data/bangs.json'
	},
	{
		id: 'kagi-kagi',
		label: 'Kagi specific',
		url: 'https://github.com/kagisearch/bangs/raw/refs/heads/main/data/kagi_bangs.json'
	}
];

export function generateDuckDuckGoCatalog(source: PersistedBangSource): ZbangCatalog {
	const records = parseSourceRecords(source);
	const normalized = records.flatMap((record) => normalizeSourceRecord(record, 'duckduckgo'));
	const deduped = dedupeNormalizedBangs(normalized);
	const items = createCatalogItems(deduped.items);

	return {
		provider: 'duckduckgo',
		generatorVersion: GENERATOR_VERSION,
		dedupedCount: deduped.dedupedCount,
		sources: [getCatalogSource(source)],
		items
	};
}

export function generateKagiCatalog(
	sharedSource: PersistedBangSource,
	kagiSource: PersistedBangSource,
	duckDuckGoSource: PersistedBangSource
): ZbangCatalog {
	const duckDuckGoByCode = getDuckDuckGoRankLookup(duckDuckGoSource);
	const normalized = [
		...parseSourceRecords(sharedSource).flatMap((record) =>
			normalizeKagiRecord(record, 'kagi-shared', duckDuckGoByCode)
		),
		...parseSourceRecords(kagiSource).flatMap((record) =>
			normalizeKagiRecord(record, 'kagi-kagi', duckDuckGoByCode)
		)
	];
	const deduped = dedupeNormalizedBangs(normalized);
	const items = createCatalogItems(deduped.items);

	return {
		provider: 'kagi',
		generatorVersion: GENERATOR_VERSION,
		dedupedCount: deduped.dedupedCount,
		sources: [
			getCatalogSource(sharedSource),
			getCatalogSource(kagiSource),
			getCatalogSource(duckDuckGoSource)
		],
		items
	};
}

export function splitZbangCatalog(catalog: ZbangCatalog): Record<BangCatalogVariant, ZbangCatalog> {
	return {
		popular: {
			...catalog,
			items: catalog.items.filter((item) => item.popularity > 0)
		},
		extended: {
			...catalog,
			items: catalog.items.filter((item) => item.popularity === 0)
		}
	};
}

export function countSourceBangs(text: string) {
	const data = JSON.parse(text) as unknown;

	return Array.isArray(data) ? data.length : undefined;
}

export function validateZbangCatalog(catalog: unknown, provider: BangProviderId): string[] {
	const errors: string[] = [];

	if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
		return ['catalog must be an object'];
	}

	const value = catalog as Partial<ZbangCatalog>;

	if (value.provider !== provider) errors.push(`provider must be ${provider}`);
	if (typeof value.generatorVersion !== 'number') {
		errors.push('generatorVersion must be a number');
	}
	if (!Array.isArray(value.sources)) errors.push('sources must be an array');
	if (!Array.isArray(value.items)) {
		errors.push('items must be an array');
		return errors;
	}

	for (const [index, item] of value.items.entries()) {
		validateZbangRecord(item, index, errors);
	}

	return errors;
}

function validateZbangRecord(item: unknown, index: number, errors: string[]) {
	const label = `items[${index}]`;

	if (!item || typeof item !== 'object' || Array.isArray(item)) {
		errors.push(`${label} must be an object`);
		return;
	}

	const value = item as Partial<CatalogZbangRecord>;

	if (typeof value.popularity !== 'number' || value.popularity < 0) {
		errors.push(`${label}.popularity must be a non-negative number`);
	}
	if (typeof value.name !== 'string' || !value.name) {
		errors.push(`${label}.name must be a non-empty string`);
	}
	if (!isStringArray(value.code) || !value.code.length) {
		errors.push(`${label}.code must be a non-empty string array`);
	}
	if (!isStringArray(value.tags)) {
		errors.push(`${label}.tags must be a string array`);
	}
	if (!value.urls || typeof value.urls !== 'object' || typeof value.urls.s !== 'string') {
		errors.push(`${label}.urls.s must be a string`);
	}
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function rankZbangRecords(items: CatalogZbangRecord[]): ZbangRecord[] {
	let rank = 0;
	let previousPopularity: number | undefined;

	return sortCatalogItems(items).map((item, index) => {
		if (item.popularity !== previousPopularity) {
			rank = index + 1;
			previousPopularity = item.popularity;
		}

		return { ...item, rank };
	});
}

function createCatalogItems(items: NormalizedBang[]): CatalogZbangRecord[] {
	return sortCatalogItems(
		items.map((item) => ({
			popularity: item.popularity,
			name: item.name,
			code: sortBangCodes(item.code, item.codeRanks),
			tags: item.tags,
			urls: item.urls
		}))
	);
}

function normalizeKagiRecord(
	record: SourceBangRecord,
	sourceId: KagiBangSourceId,
	duckDuckGoByCode: Map<string, DuckDuckGoRank>
): NormalizedBang[] {
	return normalizeSourceRecord(record, 'kagi').map((bang) => {
		const popularity = getKagiRecordPopularity(record, sourceId, duckDuckGoByCode);
		const codeRanks = Object.fromEntries(
			bang.code.map((code) => [code, duckDuckGoByCode.get(code)?.popularity ?? 0])
		);

		return { ...bang, codeRanks, popularity };
	});
}

function getKagiRecordPopularity(
	record: SourceBangRecord,
	sourceId: KagiBangSourceId,
	duckDuckGoByCode: Map<string, DuckDuckGoRank>
) {
	const code = record.t ? normalizeBangCode(record.t) : undefined;
	const duckDuckGoRank = code ? duckDuckGoByCode.get(code) : undefined;
	const isProviderNative = Boolean(record.u?.startsWith('/'));
	const mismatchedTriggers = new Set(['!p', '!q', '!k', '!code']);

	if (record.c === 'Region search') {
		return 2;
	}

	if (code && mismatchedTriggers.has(code) && isProviderNative) {
		return 2;
	}

	if (!duckDuckGoRank) {
		return 1;
	}

	if (sourceId === 'kagi-kagi' && isProviderNative && duckDuckGoRank.popularity === 0) {
		return 1;
	}

	const kagiDomain = isProviderNative
		? 'bang-provider'
		: getUrlHostname(normalizeBangUrl(record.u ?? '', 'kagi'));

	if (
		kagiDomain &&
		duckDuckGoRank.domain !== kagiDomain &&
		kagiDomain !== 'bang-provider' &&
		duckDuckGoRank.popularity > 1 &&
		getDistanceRatio(duckDuckGoRank.domain, kagiDomain) > 0.7
	) {
		return 2;
	}

	return duckDuckGoRank.popularity;
}

function normalizeSourceRecord(
	record: SourceBangRecord,
	provider: BangProviderId
): NormalizedBang[] {
	if (!record.t || !record.u || !record.s) {
		return [];
	}

	const url = normalizeBangUrl(record.u, provider);
	const code = uniqueStrings(
		[record.t, ...(record.ts ?? [])].map(normalizeBangCode).filter(isString)
	);

	if (!code.length) {
		return [];
	}

	const popularity = typeof record.r === 'number' && record.r >= 0 ? record.r : 1;

	return [
		{
			popularity,
			name: record.s,
			code,
			codeRanks: Object.fromEntries(
				code.map((trigger) => [trigger, trigger === code[0] ? popularity : 0])
			),
			tags: getBangTags(record),
			urls: { s: url },
			domains: uniqueStrings([record.d, getUrlHostname(url)].filter(isString))
		}
	];
}

function dedupeNormalizedBangs(items: NormalizedBang[]): DedupeResult {
	const groups = new Map<string, NormalizedBang>();

	for (const item of items) {
		const key = getUrlIdentity(item.urls.s);
		const existing = groups.get(key);

		if (!existing) {
			groups.set(key, item);
			continue;
		}

		groups.set(key, mergeNormalizedBangs(existing, item));
	}

	return {
		items: [...groups.values()],
		dedupedCount: items.length - groups.size
	};
}

function mergeNormalizedBangs(a: NormalizedBang, b: NormalizedBang): NormalizedBang {
	const popularity = Math.max(a.popularity, b.popularity);

	return {
		popularity,
		name: getBestName(a, b),
		code: uniqueStrings([...a.code, ...b.code]),
		codeRanks: mergeCodeRanks(a.codeRanks, b.codeRanks),
		tags: uniqueStrings([...a.tags, ...b.tags]).sort((left, right) => left.localeCompare(right)),
		urls: { s: getBestUrl(a.urls.s, b.urls.s) },
		domains: uniqueStrings([...a.domains, ...b.domains])
	};
}

function mergeCodeRanks(a: Record<string, number>, b: Record<string, number>) {
	const ranks = { ...a };

	for (const [code, rank] of Object.entries(b)) {
		ranks[code] = Math.max(ranks[code] ?? 0, rank);
	}

	return ranks;
}

function sortCatalogItems(items: CatalogZbangRecord[]): CatalogZbangRecord[] {
	return [...items].sort((a, b) => {
		const rankDifference = b.popularity - a.popularity;
		return rankDifference || a.name.localeCompare(b.name) || a.code[0].localeCompare(b.code[0]);
	});
}

function sortBangCodes(codes: string[], codeRanks: Record<string, number>) {
	if (!codes.length) return [];

	const shortest = getShortestCode(codes);
	const highestRanked = getHighestRankedCode(codes, codeRanks);
	const longest = getLongestCode(codes);
	const promoted = uniqueStrings([shortest, highestRanked, longest].filter(isString));
	const promotedSet = new Set(promoted);

	return [
		...promoted,
		...codes
			.filter((code) => !promotedSet.has(code))
			.sort((a, b) => {
				const rankDifference = (codeRanks[b] ?? 0) - (codeRanks[a] ?? 0);
				return rankDifference || a.length - b.length || a.localeCompare(b);
			})
	];
}

function getHighestRankedCode(codes: string[], codeRanks: Record<string, number>) {
	return codes.reduce((highest, code) => {
		const rankDifference = (codeRanks[code] ?? 0) - (codeRanks[highest] ?? 0);
		return rankDifference > 0 ? code : highest;
	}, codes[0]);
}

function getShortestCode(codes: string[]) {
	return codes.reduce(
		(shortest, code) => (code.length < shortest.length ? code : shortest),
		codes[0]
	);
}

function getLongestCode(codes: string[]) {
	return codes.reduce((longest, code) => (code.length > longest.length ? code : longest), codes[0]);
}

function getDuckDuckGoRankLookup(source: PersistedBangSource) {
	const lookup = new Map<string, DuckDuckGoRank>();

	for (const record of parseSourceRecords(source)) {
		const code = record.t ? normalizeBangCode(record.t) : undefined;
		const url = record.u ? normalizeBangUrl(record.u, 'duckduckgo') : undefined;
		const domain = url ? getUrlHostname(url) : undefined;

		if (code && url && domain) {
			lookup.set(code, {
				popularity: typeof record.r === 'number' && record.r >= 0 ? record.r : 1,
				domain
			});
		}
	}

	return lookup;
}

function getBangTags(record: SourceBangRecord) {
	if (record.c && record.sc) {
		return [`${record.c}/${record.sc}`];
	}

	return [record.c, record.sc].filter(isString);
}

function getBestName(a: NormalizedBang, b: NormalizedBang) {
	if (b.popularity > a.popularity) {
		return b.name;
	}

	return a.name.length <= b.name.length ? a.name : b.name;
}

function getBestUrl(a: string, b: string) {
	return [a, b].sort((left, right) => {
		const protocolPreference =
			Number(!left.startsWith('https://')) - Number(!right.startsWith('https://'));
		return protocolPreference || left.length - right.length;
	})[0];
}

function normalizeBangCode(code: string) {
	const trigger = code.trim().replace(/^!+/, '').toLowerCase();
	return trigger ? `!${trigger}` : undefined;
}

function normalizeBangUrl(url: string, provider: BangProviderId) {
	const withPlaceholder = url.replaceAll('{{{s}}}', '%s');

	if (withPlaceholder.startsWith('/')) {
		return `${provider === 'kagi' ? 'https://kagi.com' : 'https://duckduckgo.com'}${withPlaceholder}`;
	}

	return withPlaceholder;
}

export function getUrlIdentity(url: string) {
	const placeholder = '__ZBANG_QUERY_PLACEHOLDER__';
	const normalized = deepUnescape(url).trim().replaceAll('%s', placeholder);

	try {
		const parsed = new URL(normalized);
		parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');

		const path = deepUnescape(parsed.pathname)
			.replace(/\/{2,}/g, '/')
			.replace(/\/+$/, '');
		const query = [...parsed.searchParams.entries()]
			.map(([key, value]) => [deepUnescape(key), deepUnescape(value)] as const)
			.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
				return leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue);
			})
			.map(([key, value]) => `${key}=${value}`)
			.join('&');

		return `${parsed.hostname}${path}${query ? `?${query}` : ''}${deepUnescape(parsed.hash)}`
			.replaceAll(placeholder, '%s')
			.toLowerCase();
	} catch {
		return normalized.replaceAll(placeholder, '%s').toLowerCase();
	}
}

function deepUnescape(value: string) {
	const placeholder = '__ZBANG_QUERY_PLACEHOLDER__';
	let previous = value.replaceAll('%s', placeholder);
	let current = unescapeUrl(previous);

	while (previous !== current) {
		previous = current;
		current = unescapeUrl(previous);
	}

	return current.replaceAll(placeholder, '%s');
}

function unescapeUrl(value: string) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function getUrlHostname(url: string) {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
	} catch {
		return undefined;
	}
}

function getDistanceRatio(a: string, b: string) {
	return getLevenshteinDistance(a, b) / b.length;
}

function getLevenshteinDistance(a: string, b: string) {
	const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	const current = Array.from({ length: b.length + 1 }, () => 0);

	for (let i = 1; i <= a.length; i += 1) {
		current[0] = i;

		for (let j = 1; j <= b.length; j += 1) {
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + Number(a[i - 1] !== b[j - 1])
			);
		}

		previous.splice(0, previous.length, ...current);
	}

	return previous[b.length];
}

function uniqueStrings(values: string[]) {
	return [...new Set(values)];
}

function isString(value: string | undefined): value is string {
	return Boolean(value);
}

function parseSourceRecords(source: PersistedBangSource) {
	const data = JSON.parse(source.text) as unknown;

	if (!Array.isArray(data)) {
		throw new Error(`${source.id} source is not an array`);
	}

	return data as SourceBangRecord[];
}

function getCatalogSource(source: PersistedBangSource) {
	return {
		url: source.url,
		hash: source.hash
	};
}
