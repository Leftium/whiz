export type SearchDateFilters = {
	before?: string;
	after?: string;
};

export type ParsedSearchDateFilters = {
	queryWithoutFilters: string;
	filters: SearchDateFilters;
};

const searchDateFilterPattern = /^(before|after):(\d{4}-\d{2}-\d{2})$/i;

export function parseSearchDateFilters(query: string): ParsedSearchDateFilters {
	const filters: SearchDateFilters = {};
	const remainingTokens: string[] = [];
	let insideDoubleQuotes = false;

	for (const token of query.match(/\S+/g) ?? []) {
		const startsInsideDoubleQuotes = insideDoubleQuotes;
		let containsDoubleQuote = false;
		let backslashCount = 0;

		for (const character of token) {
			if (character === '"' && backslashCount % 2 === 0) {
				containsDoubleQuote = true;
				insideDoubleQuotes = !insideDoubleQuotes;
			}

			backslashCount = character === '\\' ? backslashCount + 1 : 0;
		}

		const match =
			startsInsideDoubleQuotes || containsDoubleQuote
				? undefined
				: token.match(searchDateFilterPattern);

		if (!match) {
			remainingTokens.push(token);
			continue;
		}

		const [, operator, date] = match;
		filters[operator.toLowerCase() as keyof SearchDateFilters] = date;
	}

	return {
		queryWithoutFilters: remainingTokens.join(' '),
		filters
	};
}

export function getKagiSearchUrl(query: string) {
	const trimmedQuery = query.trim();

	if (!trimmedQuery) return 'https://kagi.com/';

	const { queryWithoutFilters, filters } = parseSearchDateFilters(trimmedQuery);

	if (!filters.after && !filters.before) {
		return `https://kagi.com/search?q=${encodeURIComponent(trimmedQuery)}`;
	}

	const params = new URLSearchParams();
	if (queryWithoutFilters) params.set('q', queryWithoutFilters);
	if (filters.after) params.set('from_date', filters.after);
	if (filters.before) params.set('to_date', filters.before);

	return `https://kagi.com/search?${params}`;
}
