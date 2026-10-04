import type { ZbangRecord } from '#lib/bang-data.js';

import { normalizeBangCode } from './bang-code';
import type { BangComposition, BangCompositionTarget, BangEntry } from './types';

export function createBangCodeMap(items: ZbangRecord[]) {
	const codeMap = new Map<string, ZbangRecord>();

	for (const item of items) {
		for (const code of item.code) {
			codeMap.set(normalizeBangCode(code), item);
		}
	}

	return codeMap;
}

export function parseBangComposition(
	input: string,
	codeMap: Map<string, ZbangRecord>,
	activeEntry: BangEntry | undefined
): BangComposition {
	const localTargets: BangCompositionTarget[] = [];
	const forwardedTokens: string[] = [];
	const payloadTokens: string[] = [];
	const payloadTokensByLine = input.split('\n').map(() => [] as string[]);
	const activeTokenStart = activeEntry?.triggerIndex;
	let offset = 0;

	for (const token of input.match(/\S+/g) ?? []) {
		const index = input.indexOf(token, offset);
		offset = index + token.length;
		const lineIndex = input.slice(0, index).split('\n').length - 1;

		if (activeTokenStart !== undefined && index === activeTokenStart) continue;

		if (!/^![^\s!]+$/.test(token)) {
			payloadTokens.push(token);
			payloadTokensByLine[lineIndex]?.push(token);
			continue;
		}

		const item = codeMap.get(normalizeBangCode(token));

		if (item) {
			localTargets.push({ token, item });
		} else {
			forwardedTokens.push(token);
		}
	}

	return {
		localTargets,
		forwardedTokens,
		payloadText: payloadTokens.join(' '),
		payloadCountText: payloadTokensByLine.map((tokens) => tokens.join(' ')).join('\n'),
		hasTargets: Boolean(localTargets.length || forwardedTokens.length)
	};
}
