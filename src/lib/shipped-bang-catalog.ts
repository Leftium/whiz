import { Err, Ok, type Result } from 'wellcrafted/result';

import {
	rankZbangRecords,
	validateZbangCatalog,
	type BangCatalogVariant,
	type BangProviderId,
	type RankedZbangCatalog,
	type ZbangCatalog
} from '#lib/bang-catalog.js';

type CatalogLoadError =
	| { kind: 'network'; message: string }
	| { kind: 'http'; status: number; statusText: string }
	| { kind: 'parse'; message: string }
	| { kind: 'validation'; message: string };

const catalogUrls: Record<BangProviderId, Record<BangCatalogVariant, string>> = {
	duckduckgo: {
		popular: new URL('../../catalogs/zbang.catalog.duckduckgo.popular.json', import.meta.url).href,
		extended: new URL('../../catalogs/zbang.catalog.duckduckgo.extended.json', import.meta.url).href
	},
	kagi: {
		popular: new URL('../../catalogs/zbang.catalog.kagi.popular.json', import.meta.url).href,
		extended: new URL('../../catalogs/zbang.catalog.kagi.extended.json', import.meta.url).href
	}
};
const catalogLoadCache = new Map<string, Promise<Result<RankedZbangCatalog, CatalogLoadError>>>();

export async function loadShippedBangCatalog(
	provider: BangProviderId,
	variant: BangCatalogVariant = 'popular'
): Promise<Result<RankedZbangCatalog, CatalogLoadError>> {
	const cacheKey = `${provider}:${variant}`;
	const cachedLoad = catalogLoadCache.get(cacheKey);

	if (cachedLoad) return cachedLoad;

	const load = fetchShippedBangCatalog(provider, variant);
	catalogLoadCache.set(cacheKey, load);

	void load.then((result) => {
		if (result.error) catalogLoadCache.delete(cacheKey);
	});

	return load;
}

async function fetchShippedBangCatalog(
	provider: BangProviderId,
	variant: BangCatalogVariant
): Promise<Result<RankedZbangCatalog, CatalogLoadError>> {
	const url = catalogUrls[provider][variant];
	let response: Response;

	try {
		response = await fetch(url);
	} catch (error) {
		return Err({ kind: 'network', message: getErrorMessage(error) });
	}

	if (!response.ok) {
		return Err({ kind: 'http', status: response.status, statusText: response.statusText });
	}

	let catalog: unknown;

	try {
		catalog = await response.json();
	} catch (error) {
		return Err({ kind: 'parse', message: getErrorMessage(error) });
	}

	const errors = validateZbangCatalog(catalog, provider);

	if (errors.length) {
		return Err({ kind: 'validation', message: errors.join('; ') });
	}

	const validatedCatalog = catalog as ZbangCatalog;

	return Ok({
		...validatedCatalog,
		items: rankZbangRecords(validatedCatalog.items)
	});
}

function getErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}
