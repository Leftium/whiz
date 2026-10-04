<script lang="ts" module>
	export const inspectPanels = [
		{
			id: 'doc-json',
			label: 'doc.json()',
			description: 'Full compromise document JSON.',
			expression: 'doc.json()'
		},
		{
			id: 'terms',
			label: 'terms().json()',
			description: 'Token-level terms and tags.',
			expression: 'doc.terms().json()'
		},
		{
			id: 'topics',
			label: 'topics().json()',
			description: 'Detected topics and named entities.',
			expression: 'doc.topics().json()'
		},
		{
			id: 'people',
			label: 'people().json()',
			description: 'Detected people.',
			expression: 'doc.people().json()'
		},
		{
			id: 'places',
			label: 'places().json()',
			description: 'Detected places.',
			expression: 'doc.places().json()'
		},
		{
			id: 'organizations',
			label: 'organizations().json()',
			description: 'Detected organizations.',
			expression: 'doc.organizations().json()'
		},
		{
			id: 'dates',
			label: 'dates().json()',
			description: 'Detected date phrases from compromise-dates.',
			expression: 'doc.dates().json()'
		},
		{
			id: 'date-values',
			label: 'dates().get()',
			description: 'Parsed date metadata from compromise-dates.',
			expression: 'doc.dates().get()'
		},
		{
			id: 'times',
			label: 'times().json()',
			description: 'Detected time phrases from compromise-dates.',
			expression: 'doc.times().json()'
		},
		{
			id: 'time-values',
			label: 'times().get()',
			description: 'Parsed time metadata from compromise-dates.',
			expression: 'doc.times().get()'
		},
		{
			id: 'durations',
			label: 'durations().json()',
			description: 'Detected duration phrases from compromise-dates.',
			expression: 'doc.durations().json()'
		},
		{
			id: 'numbers',
			label: 'numbers().json()',
			description: 'Detected numeric values.',
			expression: 'doc.numbers().json()'
		},
		{
			id: 'urls',
			label: 'urls().json()',
			description: 'Detected URLs and domains.',
			expression: 'doc.urls().json()'
		},
		{
			id: 'contacts',
			label: 'contact selectors',
			description: 'Detected emails and phone numbers.',
			expression: `({
				emails: doc.emails().out('array'),
				phoneNumbers: doc.phoneNumbers().out('array')
			})`
		},
		{
			id: 'social',
			label: 'social selectors',
			description: 'Detected hashtags, @mentions, emoji, and emoticons.',
			expression: `({
				hashTags: doc.hashTags().out('array'),
				atMentions: doc.atMentions().out('array'),
				emojis: doc.emojis().out('array'),
				emoticons: doc.emoticons().out('array')
			})`
		},
		{
			id: 'values',
			label: 'value selectors',
			description: 'Detected money, percentages, and fractions.',
			expression: `({
				money: doc.money().json(),
				moneyValues: doc.money().get(),
				percentages: doc.percentages().json(),
				percentageValues: doc.percentages().get(),
				fractions: doc.fractions().json(),
				fractionValues: doc.fractions().get()
			})`
		},
		{
			id: 'phrases',
			label: 'phrase selectors',
			description: 'Quoted, parenthesized, hyphenated, and acronym text.',
			expression: `({
				quotations: doc.quotations().out('array'),
				parentheses: doc.parentheses().out('array'),
				hyphenated: doc.hyphenated().out('array'),
				acronyms: doc.acronyms().out('array')
			})`
		},
		{
			id: 'keywords',
			label: 'tfidf keywords',
			description: 'Top keyword candidates for launcher ranking.',
			expression: "doc.tfidf({ form: 'normal' }).slice(0, 8)"
		},
		{
			id: 'stats',
			label: 'stats summary',
			description: 'Common frequency outputs from compromise-stats.',
			expression: `({
				unigrams: doc.unigrams(),
				bigrams: doc.bigrams(),
				trigrams: doc.trigrams(),
				tfidf: doc.tfidf()
			})`
		},
		{
			id: 'ngrams',
			label: 'ngrams({ min: 1, max: 3 })',
			description: 'Repeating sub-phrases from compromise-stats.',
			expression: 'doc.ngrams({ min: 1, max: 3 })'
		},
		{
			id: 'tfidf',
			label: 'tfidf()',
			description: 'Word importance from compromise-stats.',
			expression: 'doc.tfidf()'
		},
		{
			id: 'tags',
			label: "out('tags')",
			description: 'Readable tag output from compromise.',
			expression: "doc.out('tags')"
		}
	] as const;

	export type InspectPanelId = (typeof inspectPanels)[number]['id'];

	export function getInspectPanelId(value: string | null): InspectPanelId {
		return inspectPanels.some((panel) => panel.id === value)
			? (value as InspectPanelId)
			: 'doc-json';
	}
</script>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import Inspect from 'svelte-inspect-value';

	import { createCompromiseDoc, nlp } from '#lib/compromise.js';

	type CompromiseTerm = {
		text: string;
		pre?: string;
		post?: string;
		tags?: string[];
		normal?: string;
		index?: number[];
		id?: string;
		chunk?: string;
	};

	type CompromiseTermPhrase = {
		terms?: CompromiseTerm[];
	};

	type TokenViewTerm = CompromiseTerm & {
		key: string;
		score?: number;
		scoreWeight: number;
	};

	let {
		text,
		inspect = 'doc-json',
		expression: expressionParam
	}: { text: string; inspect?: InspectPanelId; expression?: string } = $props();

	const doc = $derived(createCompromiseDoc(text.trim()));
	const panels = inspectPanels;
	const selectedPanel = $derived(panels.find((panel) => panel.id === inspect) ?? panels[0]);
	const evaluatedExpression = $derived(expressionParam ?? selectedPanel.expression);
	let draftExpression = $derived(evaluatedExpression);
	const activePreset = $derived(panels.find((panel) => panel.expression === evaluatedExpression));
	const inspectedValue = $derived(evaluateExpression(evaluatedExpression, text.trim(), doc));
	const tokens = $derived.by<TokenViewTerm[]>(() => {
		const phrases = doc.terms().json() as CompromiseTermPhrase[];
		const scoreEntries = doc.tfidf({ form: 'normal' });
		const scores = new Map(scoreEntries.map(([word, score]) => [word, score]));
		const maxScore = Math.max(...scoreEntries.map(([, score]) => score), 0);

		return phrases.flatMap((phrase, phraseIndex) =>
			(phrase.terms ?? []).map((term, termIndex) => {
				const score = scores.get(term.normal ?? term.text.toLowerCase());

				return {
					...term,
					key: term.id ?? `${phraseIndex}.${termIndex}.${term.text}`,
					score,
					scoreWeight: score !== undefined && maxScore > 0 ? score / maxScore : 0
				};
			})
		);
	});

	function getScoreStyle(term: TokenViewTerm) {
		if (term.score === undefined) return '';

		const bluePercent = Math.round((1 - term.scoreWeight) * 100);

		return `--token-fg: color-mix(in srgb, #2563eb ${bluePercent}%, #dc2626);`;
	}

	function formatScore(score: number) {
		return Number.isInteger(score) ? String(score) : score.toFixed(3);
	}

	function describeToken(term: TokenViewTerm) {
		return [
			term.text,
			term.score !== undefined ? `score ${formatScore(term.score)}` : undefined,
			term.tags?.length ? `tags ${term.tags.join(', ')}` : undefined,
			term.chunk ? `chunk ${term.chunk}` : undefined,
			term.index ? `index ${term.index.join(', ')}` : undefined
		]
			.filter(Boolean)
			.join('; ');
	}

	function runExpression(expression = draftExpression) {
		const nextExpression = expression.trim() || panels[0].expression;
		const nextPanel = panels.find((panel) => panel.expression === nextExpression);
		const params = new SvelteURLSearchParams();

		if (text) params.set('q', text);

		if (nextPanel) {
			params.set('inspect', nextPanel.id);
		} else {
			params.set('expr', nextExpression);
		}

		void goto(resolve(`nlp?${params}`), { replaceState: true, reset: false });
	}

	function runExpressionShortcut(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			runExpression();
		}
	}

	function evaluateExpression(
		expression: string,
		text: string,
		doc: ReturnType<typeof createCompromiseDoc>
	) {
		try {
			try {
				// TODO: Sanitize and/or sandbox evaluator input before this graduates beyond dev tooling.
				return Function(
					'text',
					'nlp',
					'doc',
					`"use strict"; return (${expression});`
				)(text, nlp, doc);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;

				return Function('text', 'nlp', 'doc', `"use strict";\n${expression}`)(text, nlp, doc);
			}
		} catch (error) {
			return {
				name: error instanceof Error ? error.name : 'Error',
				message: error instanceof Error ? error.message : String(error)
			};
		}
	}
</script>

<section class="inspector" aria-label="Compromise expression evaluator">
	<section class="token-view" aria-label="Compromise token view">
		<header>
			<div>
				<h2>Token View</h2>
				<p>Input text rendered with compromise tags. Hover or focus a token for details.</p>
			</div>
		</header>

		<div class="token-text">
			{#each tokens as term (term.key)}
				{term.pre}<button
					type="button"
					class={['token', term.score === undefined && 'token-unscored']}
					style={getScoreStyle(term)}
					aria-label={describeToken(term)}
				>
					<span>{term.text}</span>
					<span class="token-card" aria-hidden="true">
						<strong>{term.text}</strong>
						{#if term.score !== undefined}<small>score: {formatScore(term.score)}</small>{/if}
						{#if term.tags?.length}<small>tags: {term.tags.join(', ')}</small>{/if}
						{#if term.chunk}<small>chunk: {term.chunk}</small>{/if}
						{#if term.index}<small>index: {term.index.join(', ')}</small>{/if}
					</span>
				</button>{term.post}
			{:else}
				<span class="empty-token-view">Enter text to inspect compromise tokens.</span>
			{/each}
		</div>
	</section>

	<header>
		<div>
			<h2>Compromise Expression</h2>
			<p>
				{activePreset?.description ??
					'Evaluate arbitrary JS with scoped text, nlp, and doc variables.'}
			</p>
		</div>
	</header>

	<form onsubmit={(event) => (event.preventDefault(), runExpression())}>
		<label for="compromise-expression">Expression</label>
		<textarea
			id="compromise-expression"
			bind:value={draftExpression}
			onkeydown={runExpressionShortcut}
			rows="3"
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"></textarea>
		<button type="submit">Evaluate</button>
	</form>

	<nav aria-label="Expression presets">
		{#each panels as panel (panel.id)}
			<button
				class:active={panel.expression === evaluatedExpression}
				onclick={() => runExpression(panel.expression)}
			>
				{panel.label}
			</button>
		{/each}
	</nav>

	<div class="inspect-value">
		<Inspect
			value={inspectedValue}
			name="result"
			borderless
			expandLevel={2}
			noanimate
			previewDepth={0}
			quotes="none"
			showLength={false}
			showPreview={false}
			showTypes={false}
			theme=""
		/>
	</div>
</section>

<style>
	.inspector {
		display: grid;
		gap: var(--size-2);
		margin-block-start: var(--size-3);
		padding: var(--size-3);
		background: var(--nc-surface-1);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
	}

	header {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: var(--size-3);
	}

	h2,
	p {
		margin: 0;
	}

	p {
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
	}

	.token-view {
		display: grid;
		gap: var(--size-2);
	}

	.token-text {
		padding: var(--size-3);
		background:
			linear-gradient(color-mix(in srgb, var(--nc-surface-1) 88%, transparent), transparent),
			var(--nc-bg-1);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
		font-size: var(--font-size-1);
		line-height: 1.75;
		white-space: pre-wrap;
	}

	.token {
		position: relative;
		margin: 0;
		padding: 0 0.0625rem;
		color: var(--token-fg, var(--nc-tx-1));
		background: transparent;
		border: 0;
		border-radius: 0.2rem;
		font: inherit;
		line-height: inherit;
		white-space: normal;
		vertical-align: baseline;
	}

	.token:hover,
	.token:focus-visible {
		z-index: 2;
		outline: none;
	}

	.token-unscored {
		--token-fg: var(--nc-tx-2);
	}

	.token-card {
		display: none;
		position: absolute;
		inset-block-start: calc(100% + 0.35rem);
		inset-inline-start: 50%;
		width: max-content;
		max-width: min(20rem, calc(100vw - 2rem));
		padding: var(--size-2);
		translate: -50% 0;
		white-space: normal;
		text-align: left;
		background: var(--nc-surface-1);
		border: 1px solid var(--token-fg, var(--nc-border));
		border-radius: var(--nc-radius);
		box-shadow: var(--shadow-3);
		color: var(--nc-tx-1);
	}

	.token:hover .token-card,
	.token:focus-visible .token-card {
		display: grid;
		gap: 0.125rem;
	}

	.token-card strong {
		color: var(--nc-tx-1);
	}

	.token-card small {
		color: var(--nc-tx-2);
		font-family: var(--font-mono), monospace;
		font-size: 0.72rem;
		line-height: 1.35;
	}

	.empty-token-view {
		color: var(--nc-tx-2);
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	form {
		display: grid;
		gap: 0.125rem;
	}

	label {
		grid-column: 1 / -1;
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
	}

	textarea {
		width: 100%;
		min-height: 4.5rem;
		margin: 0;
		resize: vertical;
		font-family: var(--font-mono), monospace;
		font-size: var(--font-size-0);
	}

	button {
		padding: 0.0625rem 0.375rem;
		color: var(--nc-tx-2);
		background: transparent;
		text-decoration: none;
		border: 1px solid var(--nc-border);
		border-radius: 999px;
		font-size: 0.75rem;
		line-height: 1.4;
	}

	button.active {
		color: var(--nc-tx-1);
		border-color: var(--nc-primary);
	}

	button[type='submit'] {
		justify-self: stretch;
		margin: 0;
		padding: 0.375rem 0.875rem;
		color: white;
		background: var(--nc-primary);
		border-color: var(--nc-primary);
		border-radius: var(--nc-radius);
		font-weight: 600;
	}

	.inspect-value {
		--base00: #fdf6e3;
		--base01: #eee8d5;
		--base02: #93a1a1;
		--base03: #839496;
		--base04: #657b83;
		--base05: #586e75;
		--base06: #073642;
		--base07: #002b36;
		--base08: #dc322f;
		--base09: #cb4b16;
		--base0A: #b58900;
		--base0B: #859900;
		--base0C: #2aa198;
		--base0D: #268bd2;
		--base0E: #6c71c4;
		--base0F: #d33682;
		--delimiter-color: var(--base02);
		--inspect-font: fira code, monospace;
		--inspect-font-size: 14px;

		max-width: 100%;
		overflow: auto;
		padding: var(--size-2);
		background: var(--base00);
		color: var(--base05);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
	}

	.inspect-value :global(.bullet),
	.inspect-value :global(.type),
	.inspect-value :global(.count) {
		opacity: 0.3;
	}

	.inspect-value :global(.bullet) {
		opacity: 0.1;
	}

	.inspect-value :global(.key.quotedstring) {
		color: inherit;
	}

	.inspect-value :global(.indent),
	.inspect-value :global(.body) {
		overflow: inherit;
	}

	@media (prefers-color-scheme: dark) {
		.inspect-value {
			--base00: #002b36;
			--base01: #073642;
			--base02: #586e75;
			--base03: #657b83;
			--base04: #839496;
			--base05: #93a1a1;
			--base06: #eee8d5;
			--base07: #fdf6e3;
			--base08: #dc322f;
			--base09: #cb4b16;
			--base0A: #b58900;
			--base0B: #859900;
			--base0C: #2aa198;
			--base0D: #268bd2;
			--base0E: #6c71c4;
			--base0F: #d33682;
		}
	}
</style>
