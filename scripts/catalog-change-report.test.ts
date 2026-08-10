import assert from 'node:assert/strict';
import test from 'node:test';

import {
	compareCatalogSnapshots,
	formatCatalogChangeReport,
	formatCommittedUpdate,
	type CatalogSnapshot
} from './catalog-change-report.ts';
import type { BangProviderId, CatalogZbangRecord, ZbangCatalog } from '../src/lib/bang-catalog.ts';

test('compares trigger changes across catalog variants', () => {
	const previous = createSnapshot(
		'kagi',
		[createItem(['!keep'], 'https://keep.test/?q=%s')],
		[createItem(['!deleted'], 'https://deleted.test/?q=%s')]
	);
	const current = createSnapshot(
		'kagi',
		[createItem(['!added'], 'https://added.test/?q=%s')],
		[createItem(['!keep'], 'https://keep.test/?q=%s')]
	);

	const changes = compareCatalogSnapshots(previous, current);

	assert.deepEqual(changes.triggers, {
		before: 2,
		after: 2,
		added: ['!added'],
		deleted: ['!deleted'],
		modified: []
	});
	assert.deepEqual(changes.records, {
		before: 2,
		after: 2,
		added: 1,
		deleted: 1,
		variants: {
			popular: { before: 1, after: 1 },
			extended: { before: 1, after: 1 }
		}
	});
});

test('counts a URL identity change without treating its trigger as replaced', () => {
	const previous = createSnapshot('duckduckgo', [createItem(['!same'], 'https://old.test/?q=%s')]);
	const current = createSnapshot('duckduckgo', [createItem(['!same'], 'https://new.test/?q=%s')]);

	const changes = compareCatalogSnapshots(previous, current);

	assert.deepEqual(changes.triggers.added, []);
	assert.deepEqual(changes.triggers.deleted, []);
	assert.deepEqual(changes.triggers.modified, ['!same']);
	assert.equal(changes.records.added, 1);
	assert.equal(changes.records.deleted, 1);
});

test('reports semantic trigger changes while ignoring ranking, aliases, and variants', () => {
	const previous = createSnapshot(
		'kagi',
		[
			createItem(['!name'], 'https://name.test/?q=%s', { name: 'Old name' }),
			createItem(['!tags'], 'https://tags.test/?q=%s', { tags: ['Old tag'] }),
			createItem(['!url'], 'https://old-url.test/?q=%s')
		],
		[
			createItem(['!noise', '!old-alias'], 'https://noise.test/?q=%s', {
				popularity: 1
			})
		]
	);
	const current = createSnapshot(
		'kagi',
		[
			createItem(['!noise', '!new-alias'], 'https://noise.test/?q=%s', {
				popularity: 99
			})
		],
		[
			createItem(['!name'], 'https://name.test/?q=%s', { name: 'New name' }),
			createItem(['!tags'], 'https://tags.test/?q=%s', { tags: ['New tag'] }),
			createItem(['!url'], 'https://new-url.test/?q=%s')
		]
	);

	const changes = compareCatalogSnapshots(previous, current);

	assert.deepEqual(changes.triggers.added, ['!new-alias']);
	assert.deepEqual(changes.triggers.deleted, ['!old-alias']);
	assert.deepEqual(changes.triggers.modified, ['!name', '!tags', '!url']);
});

test('formats sorted trigger lists as indented wrapped lines', () => {
	const previous = createSnapshot('kagi');
	const current = createSnapshot('kagi', [
		createItem(['!zeta', '!alpha', '!long-trigger'], 'https://new.test/?q=%s')
	]);
	const report = formatCatalogChangeReport(
		[compareCatalogSnapshots(previous, current)],
		'2026-07-02T08:23:44+09:00',
		new Date('2026-08-11T08:23:44+09:00'),
		31
	);

	assert.match(report, /Last committed update: 2026-07-02 08:23 \+09:00 \(40 days ago\)/);
	assert.match(
		report,
		/  Added triggers: 3\n    !alpha, !long-trigger,\n    !zeta\n  Deleted triggers: 0\n  Modified triggers: 0/
	);
});

test('formats unavailable baselines and Git history explicitly', () => {
	const current = createSnapshot('duckduckgo', [createItem(['!only'], 'https://only.test/?q=%s')]);
	const report = formatCatalogChangeReport([compareCatalogSnapshots(undefined, current)]);

	assert.match(report, /Last committed update: unknown/);
	assert.match(report, /Triggers: 1 \(baseline unavailable\)/);
	assert.match(report, /Added triggers: unknown/);
	assert.match(report, /Modified triggers: unknown/);
	assert.match(report, /Total:\s+1 \(baseline unavailable\)/);
	assert.equal(formatCommittedUpdate('not-a-date'), 'unknown');
});

function createSnapshot(
	provider: BangProviderId,
	popular: CatalogZbangRecord[] = [],
	extended: CatalogZbangRecord[] = []
): CatalogSnapshot {
	return {
		popular: createCatalog(provider, popular),
		extended: createCatalog(provider, extended)
	};
}

function createCatalog(provider: BangProviderId, items: CatalogZbangRecord[]): ZbangCatalog {
	return {
		provider,
		generatorVersion: 1,
		sources: [],
		items
	};
}

function createItem(
	code: string[],
	url: string,
	overrides: Partial<Pick<CatalogZbangRecord, 'name' | 'popularity' | 'tags'>> = {}
): CatalogZbangRecord {
	return {
		popularity: 1,
		name: code[0],
		code,
		tags: [],
		urls: { s: url },
		...overrides
	};
}
