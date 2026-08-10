import {
	BANG_CATALOG_VARIANTS,
	getUrlIdentity,
	type BangCatalogVariant,
	type BangProviderId,
	type CatalogZbangRecord,
	type ZbangCatalog
} from '../src/lib/bang-catalog.ts';

export type CatalogSnapshot = Record<BangCatalogVariant, ZbangCatalog>;

export type CatalogChanges = {
	provider: BangProviderId;
	triggers: {
		before?: number;
		after: number;
		added?: string[];
		deleted?: string[];
		modified?: string[];
	};
	records: {
		before?: number;
		after: number;
		added?: number;
		deleted?: number;
		variants: Record<
			BangCatalogVariant,
			{
				before?: number;
				after: number;
			}
		>;
	};
};

export function compareCatalogSnapshots(
	previous: CatalogSnapshot | undefined,
	current: CatalogSnapshot
): CatalogChanges {
	const currentItems = getSnapshotItems(current);
	const currentRecordsByTrigger = getRecordsByTrigger(currentItems);
	const currentTriggers = new Set(currentRecordsByTrigger.keys());
	const currentRecordIdentities = getRecordIdentities(currentItems);
	const variants = Object.fromEntries(
		BANG_CATALOG_VARIANTS.map((variant) => [
			variant,
			{
				before: previous?.[variant].items.length,
				after: current[variant].items.length
			}
		])
	) as CatalogChanges['records']['variants'];

	if (!previous) {
		return {
			provider: current.popular.provider,
			triggers: { after: currentTriggers.size },
			records: {
				after: currentItems.length,
				variants
			}
		};
	}

	const previousItems = getSnapshotItems(previous);
	const previousRecordsByTrigger = getRecordsByTrigger(previousItems);
	const previousTriggers = new Set(previousRecordsByTrigger.keys());
	const previousRecordIdentities = getRecordIdentities(previousItems);

	return {
		provider: current.popular.provider,
		triggers: {
			before: previousTriggers.size,
			after: currentTriggers.size,
			added: getSetDifference(currentTriggers, previousTriggers),
			deleted: getSetDifference(previousTriggers, currentTriggers),
			modified: getModifiedTriggers(previousRecordsByTrigger, currentRecordsByTrigger)
		},
		records: {
			before: previousItems.length,
			after: currentItems.length,
			added: getSetDifference(currentRecordIdentities, previousRecordIdentities).length,
			deleted: getSetDifference(previousRecordIdentities, currentRecordIdentities).length,
			variants
		}
	};
}

export function formatCatalogChangeReport(
	changes: CatalogChanges[],
	lastCommittedUpdate?: string,
	now = new Date(),
	lineWidth = 100
) {
	const lines = [
		'Catalog refresh',
		`  Last committed update: ${formatCommittedUpdate(lastCommittedUpdate, now)}`
	];

	for (const change of changes) {
		lines.push('', change.provider);

		if (change.triggers.before === undefined) {
			lines.push(`  Triggers: ${formatCount(change.triggers.after)} (baseline unavailable)`);
			lines.push(
				'',
				'  Added triggers: unknown',
				'  Deleted triggers: unknown',
				'  Modified triggers: unknown'
			);
		} else {
			lines.push(
				`  Triggers: ${formatCount(change.triggers.before)} -> ${formatCount(change.triggers.after)}`,
				'',
				...formatTriggerChange('Added', change.triggers.added ?? [], lineWidth),
				...formatTriggerChange('Deleted', change.triggers.deleted ?? [], lineWidth),
				...formatTriggerChange('Modified', change.triggers.modified ?? [], lineWidth)
			);
		}

		lines.push('', '  Final deduped records');
		const totalLabel = 'Total:'.padEnd(9);

		if (change.records.before === undefined) {
			lines.push(`    ${totalLabel} ${formatCount(change.records.after)} (baseline unavailable)`);
		} else {
			lines.push(
				`    ${totalLabel} ${formatCount(change.records.before)} -> ${formatCount(change.records.after)} (+${formatCount(change.records.added ?? 0)}/-${formatCount(change.records.deleted ?? 0)})`
			);
		}

		for (const variant of BANG_CATALOG_VARIANTS) {
			const counts = change.records.variants[variant];
			const label = `${variant[0].toUpperCase()}${variant.slice(1)}:`.padEnd(9);
			const value =
				counts.before === undefined
					? formatCount(counts.after)
					: `${formatCount(counts.before)} -> ${formatCount(counts.after)}`;
			lines.push(`    ${label} ${value}`);
		}
	}

	return lines.join('\n');
}

export function formatCommittedUpdate(value: string | undefined, now = new Date()) {
	if (!value) return 'unknown';

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) return 'unknown';

	const elapsedDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
	const age = elapsedDays === 0 ? 'today' : `${elapsedDays} day${elapsedDays === 1 ? '' : 's'} ago`;
	const displayDate = value.replace('T', ' ').replace(/:\d{2}([+-]\d{2}:\d{2})$/, ' $1');

	return `${displayDate} (${age})`;
}

function getSnapshotItems(snapshot: CatalogSnapshot) {
	return BANG_CATALOG_VARIANTS.flatMap((variant) => snapshot[variant].items);
}

function getRecordsByTrigger(items: CatalogZbangRecord[]) {
	return new Map(items.flatMap((item) => item.code.map((code) => [code, item] as const)));
}

function getRecordIdentities(items: CatalogZbangRecord[]) {
	return new Set(items.map((item) => getUrlIdentity(item.urls.s)));
}

function getSetDifference<T>(left: Set<T>, right: Set<T>) {
	return [...left].filter((value) => !right.has(value)).sort();
}

function getModifiedTriggers(
	previous: Map<string, CatalogZbangRecord>,
	current: Map<string, CatalogZbangRecord>
) {
	return [...current]
		.filter(([code, item]) => {
			const previousItem = previous.get(code);
			if (!previousItem) return false;

			return getTriggerDefinition(previousItem) !== getTriggerDefinition(item);
		})
		.map(([code]) => code)
		.sort();
}

function getTriggerDefinition(item: CatalogZbangRecord) {
	return JSON.stringify({ name: item.name, tags: item.tags, urls: item.urls });
}

function formatTriggerChange(label: string, triggers: string[], lineWidth: number) {
	const lines = [`  ${label} triggers: ${formatCount(triggers.length)}`];

	if (triggers.length) {
		lines.push(...wrapList(triggers, '    ', lineWidth));
	}

	return lines;
}

function wrapList(values: string[], indentation: string, lineWidth: number) {
	const lines: string[] = [];
	let line = indentation;

	for (const [index, value] of values.entries()) {
		const token = `${value}${index === values.length - 1 ? '' : ','}`;
		const separator = line === indentation ? '' : ' ';

		if (line !== indentation && line.length + separator.length + token.length > lineWidth) {
			lines.push(line);
			line = `${indentation}${token}`;
		} else {
			line += `${separator}${token}`;
		}
	}

	if (line !== indentation) lines.push(line);

	return lines;
}

function formatCount(value: number) {
	return value.toLocaleString('en-US');
}
