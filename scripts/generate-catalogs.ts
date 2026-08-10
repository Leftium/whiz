import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	BANG_CATALOG_VARIANTS,
	BANG_SOURCES,
	countSourceBangs,
	generateDuckDuckGoCatalog,
	generateKagiCatalog,
	splitZbangCatalog,
	validateZbangCatalog,
	type BangCatalogVariant,
	type BangProviderId,
	type BangSourceId,
	type PersistedBangSource,
	type ZbangCatalog
} from '../src/lib/bang-catalog.ts';
import {
	compareCatalogSnapshots,
	formatCatalogChangeReport,
	type CatalogSnapshot
} from './catalog-change-report.ts';

type CatalogOutput = {
	provider: BangProviderId;
	variant: BangCatalogVariant;
	filename: string;
	catalog: ZbangCatalog;
};

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = resolve(rootDir, 'catalogs');
const providers = ['duckduckgo', 'kagi'] satisfies BangProviderId[];

async function main() {
	const [previousCatalogs, lastCommittedUpdate, downloadedSources] = await Promise.all([
		readCatalogBaselines(),
		getLastCommittedCatalogUpdate(),
		Promise.all(BANG_SOURCES.map(downloadSource))
	]);
	const sources = new Map(downloadedSources.map((source) => [source.id, source]));
	const duckDuckGoSource = requireSource(sources, 'duckduckgo');
	const providerCatalogs = [
		{
			provider: 'duckduckgo',
			catalog: generateDuckDuckGoCatalog(duckDuckGoSource)
		},
		{
			provider: 'kagi',
			catalog: generateKagiCatalog(
				requireSource(sources, 'kagi-shared'),
				requireSource(sources, 'kagi-kagi'),
				duckDuckGoSource
			)
		}
	] satisfies Array<{ provider: BangProviderId; catalog: ZbangCatalog }>;
	const currentCatalogs = new Map(
		providerCatalogs.map(({ provider, catalog }) => [provider, splitZbangCatalog(catalog)])
	);
	const outputs: CatalogOutput[] = providerCatalogs.flatMap(({ provider }) => {
		const variants = requireCatalogSnapshot(currentCatalogs, provider);

		return BANG_CATALOG_VARIANTS.map((variant) => ({
			provider,
			variant,
			filename: getCatalogFilename(provider, variant),
			catalog: variants[variant]
		}));
	});

	await mkdir(catalogDir, { recursive: true });
	await Promise.all(
		providers.map((provider) =>
			rm(resolve(catalogDir, `zbang.catalog.${provider}.json`), { force: true })
		)
	);

	const generatedFiles: Array<CatalogOutput & { bytes: number; path: string }> = [];

	for (const output of outputs) {
		const errors = validateZbangCatalog(output.catalog, output.provider);

		if (errors.length) {
			throw new Error(`${output.provider} catalog failed validation:\n${errors.join('\n')}`);
		}

		const json = `${JSON.stringify(output.catalog, null, '\t')}\n`;
		const path = resolve(catalogDir, output.filename);
		await writeFile(path, json);
		generatedFiles.push({ ...output, bytes: Buffer.byteLength(json), path });
	}

	const changes = providers.map((provider) =>
		compareCatalogSnapshots(
			previousCatalogs.get(provider),
			requireCatalogSnapshot(currentCatalogs, provider)
		)
	);
	console.log(formatCatalogChangeReport(changes, lastCommittedUpdate));
	console.log('\nGenerated files');

	for (const output of generatedFiles) {
		console.log(
			[
				`  ${output.provider} ${output.variant}: ${output.catalog.items.length.toLocaleString()} records`,
				`${output.catalog.dedupedCount?.toLocaleString() ?? 0} deduped`,
				`${output.bytes.toLocaleString()} bytes`,
				output.path
			].join(' | ')
		);
	}

	console.log('\nSources');

	for (const source of sources.values()) {
		console.log(
			[
				`  ${source.id}: ${source.bangCount?.toLocaleString() ?? 'unknown'} source records`,
				`sha256 ${source.hash}`,
				source.url
			].join(' | ')
		);
	}
}

function getCatalogFilename(provider: BangProviderId, variant: BangCatalogVariant) {
	return `zbang.catalog.${provider}.${variant}.json`;
}

async function readCatalogBaselines() {
	const baselines = new Map<BangProviderId, CatalogSnapshot>();

	await Promise.all(
		providers.map(async (provider) => {
			const entries = await Promise.all(
				BANG_CATALOG_VARIANTS.map(async (variant) => {
					const path = resolve(catalogDir, getCatalogFilename(provider, variant));

					try {
						const value: unknown = JSON.parse(await readFile(path, 'utf8'));

						if (validateZbangCatalog(value, provider).length) return undefined;

						return [variant, value as ZbangCatalog] as const;
					} catch {
						return undefined;
					}
				})
			);

			if (entries.every((entry) => entry !== undefined)) {
				baselines.set(provider, Object.fromEntries(entries) as CatalogSnapshot);
			}
		})
	);

	return baselines;
}

function getLastCommittedCatalogUpdate() {
	const catalogPaths = providers.flatMap((provider) =>
		BANG_CATALOG_VARIANTS.map((variant) => `catalogs/${getCatalogFilename(provider, variant)}`)
	);

	return new Promise<string | undefined>((resolvePromise) => {
		execFile(
			'git',
			['log', '-1', '--format=%cI', '--', ...catalogPaths],
			{ cwd: rootDir, encoding: 'utf8' },
			(error, stdout) => resolvePromise(error ? undefined : stdout.trim() || undefined)
		);
	});
}

function requireCatalogSnapshot(
	catalogs: Map<BangProviderId, CatalogSnapshot>,
	provider: BangProviderId
) {
	const catalog = catalogs.get(provider);

	if (!catalog) throw new Error(`${provider} catalog has not been generated`);

	return catalog;
}

async function downloadSource(source: (typeof BANG_SOURCES)[number]): Promise<PersistedBangSource> {
	const response = await fetch(source.url);

	if (!response.ok) {
		throw new Error(`Failed to fetch ${source.label}: ${response.status} ${response.statusText}`);
	}

	const text = await response.text();

	return {
		id: source.id,
		url: source.url,
		hash: createHash('sha256').update(text).digest('hex'),
		bangCount: countSourceBangs(text),
		text
	};
}

function requireSource(sources: Map<BangSourceId, PersistedBangSource>, id: BangSourceId) {
	const source = sources.get(id);

	if (!source) {
		throw new Error(`${id} source has not been downloaded`);
	}

	return source;
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
