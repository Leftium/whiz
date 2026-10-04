import { createCompromiseDoc } from '#lib/compromise.js';
import type { CompromiseSignals, KeywordSignal } from './types';

type MoneyJson = { text?: string; number?: { prefix?: string; unit?: string } };

export function getCompromiseSignals(input: string): CompromiseSignals {
	const text = input.trim();

	if (!text) {
		return {
			terms: [],
			topics: [],
			people: [],
			places: [],
			organizations: [],
			questions: [],
			urls: [],
			emails: [],
			phoneNumbers: [],
			hashTags: [],
			atMentions: [],
			emojis: [],
			emoticons: [],
			money: [],
			currencies: [],
			percentages: [],
			fractions: [],
			acronyms: [],
			hyphenated: [],
			quotations: [],
			parentheses: [],
			keywords: [],
			dates: [],
			times: [],
			durations: [],
			verbs: [],
			nouns: []
		};
	}

	const doc = createCompromiseDoc(text);
	const money = doc.money();

	return {
		terms: unique(doc.terms().out('array')),
		topics: unique(doc.topics().out('array')),
		people: unique(doc.people().out('array')),
		places: unique(doc.places().out('array')),
		organizations: unique(doc.organizations().out('array')),
		questions: unique(doc.questions().out('array')),
		urls: unique(doc.urls().out('array')),
		emails: unique(doc.emails().out('array')),
		phoneNumbers: unique(doc.phoneNumbers().out('array')),
		hashTags: unique(doc.hashTags().out('array')),
		atMentions: unique(doc.atMentions().out('array')),
		emojis: unique(doc.emojis().out('array')),
		emoticons: unique(doc.emoticons().out('array')),
		money: getMoneyAmounts(money.json() as MoneyJson[]),
		currencies: getCurrencies(money.json() as MoneyJson[]),
		percentages: unique(doc.percentages().out('array')),
		fractions: unique(doc.fractions().out('array')),
		acronyms: unique(doc.acronyms().out('array')),
		hyphenated: unique(doc.hyphenated().out('array')),
		quotations: unique(doc.quotations().out('array')),
		parentheses: unique(doc.parentheses().out('array')),
		keywords: uniqueKeywords(doc.tfidf({ form: 'normal' }).slice(0, 8)),
		dates: unique(doc.dates().out('array')),
		times: unique(doc.times().out('array')),
		durations: unique(doc.durations().out('array')),
		verbs: unique(doc.verbs().out('array')),
		nouns: unique(doc.nouns().out('array'))
	};
}

export function unique(values: string[]) {
	return [...new Set(values.filter(Boolean))];
}

function uniqueKeywords(values: [word: string, score: number][]) {
	return values.reduce<KeywordSignal[]>((keywords, [word, score]) => {
		if (!word || keywords.some((keyword) => keyword.word === word)) return keywords;

		keywords.push({ word, score });
		return keywords;
	}, []);
}

function getCurrencies(values: MoneyJson[]) {
	return unique(
		values.flatMap(({ number }) =>
			[number?.prefix, number?.unit].filter((value): value is string => Boolean(value?.trim()))
		)
	);
}

function getMoneyAmounts(values: MoneyJson[]) {
	return unique(values.flatMap(({ text, number }) => (hasCurrency(number) && text ? [text] : [])));
}

function hasCurrency(number: MoneyJson['number']) {
	return Boolean(number?.prefix?.trim() || number?.unit?.trim());
}
