import type { ZbangRecord } from '$lib/bang-data';
import { defaultCustomSearchTemplate, type SearchProvider } from '$lib/execution-settings';

import { getBangCodeSet, removeBangCodeOverlaps } from './bang-code';
import { createBangCodeMap, parseBangComposition } from './bang-composition';
import { getKagiSearchUrl } from './search-date-filters';
import type { BangComposition } from './types';

export type BangExecutionSettings = {
	searchProvider: SearchProvider;
	customSearchTemplate: string;
};

export type BangExecutionResult = {
	targetUrl: string;
	targetUrls: string[];
	composition: BangComposition;
};

export type BangExecutionFallbackOptions = {
	extendedBangs?: ZbangRecord[];
	extendedLoaded?: boolean;
	loadExtendedBangs?: () => Promise<ZbangRecord[] | undefined>;
};

export type BangExecutionFallbackResult = {
	result: BangExecutionResult;
	extendedBangs: ZbangRecord[];
	loadedExtended: boolean;
	extendedLoadFailed: boolean;
};

export function resolveBangExecution(
	query: string,
	items: ZbangRecord[],
	settings: BangExecutionSettings
): BangExecutionResult {
	const composition = parseBangComposition(query, createBangCodeMap(items), undefined);
	const targetUrls = getBangExecutionTargetUrls(composition, settings);
	const firstTargetUrl = targetUrls[0];

	if (firstTargetUrl) {
		return {
			composition,
			targetUrl: firstTargetUrl,
			targetUrls
		};
	}

	return {
		composition,
		targetUrl: getSearchUrl(settings.searchProvider, query, settings.customSearchTemplate),
		targetUrls: [getSearchUrl(settings.searchProvider, query, settings.customSearchTemplate)]
	};
}

export async function resolveBangExecutionWithExtendedFallback(
	query: string,
	myBangs: ZbangRecord[],
	popularProviderBangs: ZbangRecord[],
	settings: BangExecutionSettings,
	options: BangExecutionFallbackOptions = {}
): Promise<BangExecutionFallbackResult> {
	const extendedBangs = options.extendedBangs ?? [];
	const extendedLoaded = options.extendedLoaded ?? extendedBangs.length > 0;
	const result = resolveBangExecution(
		query,
		getBangExecutionItems(myBangs, popularProviderBangs, extendedLoaded ? extendedBangs : []),
		settings
	);

	if (extendedLoaded || !result.composition.forwardedTokens.length || !options.loadExtendedBangs) {
		return {
			result,
			extendedBangs,
			loadedExtended: false,
			extendedLoadFailed: false
		};
	}

	try {
		const loadedExtendedBangs = await options.loadExtendedBangs();

		if (!loadedExtendedBangs) {
			return {
				result,
				extendedBangs,
				loadedExtended: false,
				extendedLoadFailed: true
			};
		}

		return {
			result: resolveBangExecution(
				query,
				getBangExecutionItems(myBangs, popularProviderBangs, loadedExtendedBangs),
				settings
			),
			extendedBangs: loadedExtendedBangs,
			loadedExtended: true,
			extendedLoadFailed: false
		};
	} catch {
		return {
			result,
			extendedBangs,
			loadedExtended: false,
			extendedLoadFailed: true
		};
	}
}

export function getBangExecutionTargetUrls(
	composition: BangComposition,
	settings: BangExecutionSettings
) {
	const targetUrls = composition.localTargets.map(({ item }) =>
		composition.payloadText ? getBangSearchUrl(item, composition.payloadText) : getBangOpenUrl(item)
	);

	if (composition.forwardedTokens.length) {
		const forwardedQuery = [...composition.forwardedTokens, composition.payloadText]
			.filter(Boolean)
			.join(' ');

		targetUrls.push(
			getSearchUrl(settings.searchProvider, forwardedQuery, settings.customSearchTemplate)
		);
	}

	return targetUrls;
}

export function getBangExecutionItems(
	myBangs: ZbangRecord[],
	popularProviderBangs: ZbangRecord[],
	extendedProviderBangs: ZbangRecord[] = []
) {
	const myBangCodes = getBangCodeSet(myBangs);
	const filteredPopularProviderBangs = removeBangCodeOverlaps(popularProviderBangs, myBangCodes);
	const popularBangCodes = getBangCodeSet([...myBangs, ...filteredPopularProviderBangs]);
	const filteredExtendedProviderBangs = removeBangCodeOverlaps(
		extendedProviderBangs,
		popularBangCodes
	);

	return [...myBangs, ...filteredPopularProviderBangs, ...filteredExtendedProviderBangs];
}

export function getSearchUrl(
	provider: SearchProvider,
	query: string,
	customTemplate = defaultCustomSearchTemplate
) {
	const trimmedQuery = query.trim();
	const customSearchTemplate = customTemplate.includes('%s')
		? customTemplate
		: defaultCustomSearchTemplate;

	if (provider === 'kagi') return getKagiSearchUrl(query);

	if (!trimmedQuery) {
		return {
			duckduckgo: 'https://duckduckgo.com/',
			google: 'https://www.google.com/',
			custom: customSearchTemplate.replace(/%s/g, '')
		}[provider];
	}

	const encodedQuery = encodeURIComponent(trimmedQuery);

	return {
		duckduckgo: `https://duckduckgo.com/?q=${encodedQuery}`,
		google: `https://www.google.com/search?q=${encodedQuery}`,
		custom: customSearchTemplate.replace(/%s/g, encodedQuery)
	}[provider];
}

export function hasBangToken(value: string) {
	return (value.match(/\S+/g) ?? []).some((token) => /^![^\s!]+$/.test(token));
}

export function getBangSearchUrl(item: ZbangRecord, query: string) {
	return item.urls.s.replace(/%s/g, encodeURIComponent(query.trim()));
}

export function getBangOpenUrl(item: ZbangRecord) {
	const placeholder = '__zbang_query__';
	const template = item.urls.s.replace(/%s/g, placeholder);

	try {
		const url = new URL(template);
		const params = [...url.searchParams.entries()];
		const hasQueryPlaceholder = params.some(([, value]) => value.includes(placeholder));

		for (const [key, value] of params) {
			if (value.includes(placeholder)) url.searchParams.delete(key);
		}

		if (url.hash.includes(placeholder)) url.hash = '';

		if (url.pathname.includes(placeholder)) {
			url.pathname = url.pathname
				.split('/')
				.filter((segment) => segment && !segment.includes(placeholder))
				.join('/');
		}

		return hasQueryPlaceholder ? `${url.origin}/` : url.toString();
	} catch {
		return item.urls.s.replace(/%s/g, '');
	}
}
