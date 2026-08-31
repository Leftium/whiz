import assert from 'node:assert/strict';
import test from 'node:test';

import { getKagiSearchUrl, parseSearchDateFilters } from './search-date-filters.ts';

test('parses date-shaped filters without validating dates or ranges', () => {
	assert.deepEqual(parseSearchDateFilters('release after:2026-01-01 before:2025-99-99 notes'), {
		queryWithoutFilters: 'release notes',
		filters: {
			after: '2026-01-01',
			before: '2025-99-99'
		}
	});
});

test('uses the last recognized occurrence and removes every recognized filter', () => {
	assert.deepEqual(parseSearchDateFilters('after:2025-01-01 notes AFTER:2025-02-01'), {
		queryWithoutFilters: 'notes',
		filters: { after: '2025-02-01' }
	});
});

test('preserves filters in double-quoted phrases and tokens with unsupported shapes', () => {
	assert.deepEqual(parseSearchDateFilters('"history before:2025-01-01" before:2025 notes'), {
		queryWithoutFilters: '"history before:2025-01-01" before:2025 notes',
		filters: {}
	});
});

test('preserves the existing Kagi URL when no filter is recognized', () => {
	assert.equal(getKagiSearchUrl('  release notes  '), 'https://kagi.com/search?q=release%20notes');
});

test('builds a cleaned Kagi query with date parameters', () => {
	const url = new URL(getKagiSearchUrl('release after:2025-01-01 notes before:2026-01-01'));

	assert.equal(url.searchParams.get('q'), 'release notes');
	assert.equal(url.searchParams.get('from_date'), '2025-01-01');
	assert.equal(url.searchParams.get('to_date'), '2026-01-01');
});

test('supports a shared query containing only a date filter', () => {
	const url = new URL(getKagiSearchUrl('after:2025-01-01'));

	assert.equal(url.searchParams.has('q'), false);
	assert.equal(url.searchParams.get('from_date'), '2025-01-01');
});
