<script module lang="ts">
	import type { JournalEntry as EditorJournalEntry } from '#lib/journal.js';

	export type JournalEntryEditorSession = {
		key: string;
		entryDate: string;
		entry?: EditorJournalEntry;
	};

	export type JournalEntryEditorSave = {
		entry?: EditorJournalEntry;
		entryDate: string;
		bodyMarkdown: string;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';

	import {
		parseJournalMarkdown,
		type JournalEntry,
		type JournalMarkdownInline
	} from '#lib/journal.js';

	let {
		session,
		onSave,
		onCancel,
		onDelete
	}: {
		session: JournalEntryEditorSession;
		onSave: (draft: JournalEntryEditorSave) => void | Promise<void>;
		onCancel: () => void;
		onDelete: (entry: JournalEntry) => void | Promise<void>;
	} = $props();

	let activeSessionKey = $state('');
	let entryDate = $state('');
	let bodyMarkdown = $state('');
	let initialSnapshot = $state('');
	let submitAttempted = $state(false);
	let deleteConfirm = $state(false);
	let saving = $state(false);
	let bodyInput = $state<HTMLTextAreaElement>();

	const editorTitleId = $derived(
		`journal-entry-editor-title-${session.key.replace(/[^a-z0-9_-]/gi, '-')}`
	);
	const bodyError = $derived(
		submitAttempted && !bodyMarkdown.trim() ? 'Entry text is required.' : ''
	);
	const dirty = $derived(getDraftSnapshot() !== initialSnapshot);
	const markdownBlocks = $derived(parseJournalMarkdown(bodyMarkdown));
	const previewEmpty = $derived(!bodyMarkdown.trim());

	$effect(() => {
		if (session.key === activeSessionKey) return;

		activeSessionKey = session.key;
		entryDate = session.entry?.entryDate ?? session.entryDate;
		bodyMarkdown = session.entry?.bodyMarkdown ?? '';
		initialSnapshot = getDraftSnapshot();
		submitAttempted = false;
		deleteConfirm = false;
		saving = false;

		void tick().then(() => bodyInput?.focus());
	});

	function getDraftSnapshot() {
		return JSON.stringify({
			entryDate,
			bodyMarkdown: bodyMarkdown.trim()
		});
	}

	function requestCancel() {
		if (!dirty || confirm('Discard unsaved journal changes?')) {
			onCancel();
		}
	}

	async function submitEditor(event: SubmitEvent) {
		event.preventDefault();
		submitAttempted = true;

		if (!bodyMarkdown.trim()) {
			bodyInput?.focus();
			return;
		}

		saving = true;

		try {
			await onSave({
				entry: session.entry,
				entryDate,
				bodyMarkdown: bodyMarkdown.trim()
			});
		} finally {
			saving = false;
		}
	}

	async function requestDelete() {
		if (!session.entry) return;

		if (!deleteConfirm) {
			deleteConfirm = true;
			return;
		}

		saving = true;

		try {
			await onDelete(session.entry);
		} finally {
			saving = false;
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;

		event.preventDefault();

		if (deleteConfirm) {
			deleteConfirm = false;
			return;
		}

		requestCancel();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) requestCancel();
	}

	function getMarkdownLinkAttributes(href: string) {
		return {
			href,
			target: '_blank',
			rel: 'noopener noreferrer'
		};
	}
</script>

<svelte:window onkeydown={handleWindowKeydown} />

{#snippet inlineMarkdown(nodes: JournalMarkdownInline[])}
	{#each nodes as node, index (`${index}-${node.kind}-${node.text}`)}
		{#if node.kind === 'text'}
			{node.text}
		{:else if node.kind === 'code'}
			<code>{node.text}</code>
		{:else if node.kind === 'strong'}
			<strong>{node.text}</strong>
		{:else if node.kind === 'em'}
			<em>{node.text}</em>
		{:else}
			<a {...getMarkdownLinkAttributes(node.href)}>{node.text}</a>
		{/if}
	{/each}
{/snippet}

<div class="journal-entry-editor-backdrop" onclick={handleBackdropClick} role="presentation">
	<div class="journal-entry-editor" role="dialog" aria-modal="true" aria-labelledby={editorTitleId}>
		<form onsubmit={submitEditor}>
			<header>
				<div>
					<p class="editor-eyebrow">Journal</p>
					<h2 id={editorTitleId}>{session.entry ? 'Edit entry' : 'New entry'}</h2>
				</div>
				<button type="button" class="icon-button" aria-label="Close editor" onclick={requestCancel}>
					x
				</button>
			</header>

			<div class="editor-body">
				<label>
					<span>Date</span>
					<input bind:value={entryDate} type="date" required />
				</label>

				<label>
					<span>Entry</span>
					<textarea
						bind:this={bodyInput}
						bind:value={bodyMarkdown}
						aria-invalid={Boolean(bodyError)}
						aria-describedby={bodyError ? 'journal-entry-body-error' : undefined}
						rows="10"
						spellcheck="true"></textarea>
				</label>
				{#if bodyError}
					<p class="field-error" id="journal-entry-body-error">{bodyError}</p>
				{/if}

				<section class="journal-preview" aria-label="Markdown preview">
					{#if previewEmpty}
						<p class="preview-empty">Nothing to preview.</p>
					{:else}
						<div class="journal-rendered">
							{#each markdownBlocks as block, index (`${index}-${block.kind}`)}
								{#if block.kind === 'heading'}
									{#if block.level === 2}
										<h2>{@render inlineMarkdown(block.children)}</h2>
									{:else if block.level === 3}
										<h3>{@render inlineMarkdown(block.children)}</h3>
									{:else}
										<h4>{@render inlineMarkdown(block.children)}</h4>
									{/if}
								{:else if block.kind === 'paragraph'}
									<p>{@render inlineMarkdown(block.children)}</p>
								{:else if block.kind === 'list'}
									{#if block.ordered}
										<ol>
											{#each block.items as item, itemIndex (`${itemIndex}-${item.length}`)}
												<li>{@render inlineMarkdown(item)}</li>
											{/each}
										</ol>
									{:else}
										<ul>
											{#each block.items as item, itemIndex (`${itemIndex}-${item.length}`)}
												<li>{@render inlineMarkdown(item)}</li>
											{/each}
										</ul>
									{/if}
								{:else if block.kind === 'blockquote'}
									<blockquote>
										<p>{@render inlineMarkdown(block.children)}</p>
									</blockquote>
								{:else}
									<pre><code>{block.text}</code></pre>
								{/if}
							{/each}
						</div>
					{/if}
				</section>
			</div>

			<footer>
				{#if session.entry}
					<button type="button" class:danger-confirm={deleteConfirm} onclick={requestDelete}>
						{deleteConfirm ? 'Confirm delete' : 'Delete'}
					</button>
				{/if}
				<span class="footer-spacer"></span>
				<button type="button" onclick={requestCancel}>Cancel</button>
				<button type="submit" disabled={saving}>Save</button>
			</footer>
		</form>
	</div>
</div>

<style>
	.journal-entry-editor-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: var(--size-3);
		background: rgb(0 0 0 / 0.36);
	}

	.journal-entry-editor {
		width: min(44rem, 100%);
		max-height: min(92dvh, 50rem);
		overflow: hidden;
		color: var(--nc-tx-1);
		background: var(--nc-surface-1);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
		box-shadow: 0 1rem 3rem rgb(0 0 0 / 0.24);
	}

	form {
		display: grid;
		max-height: inherit;
	}

	header,
	footer {
		display: flex;
		align-items: center;
		gap: var(--size-2);
		padding: var(--size-3);
	}

	header {
		justify-content: space-between;
		border-block-end: 1px solid var(--nc-border);
	}

	header h2,
	header p {
		margin: 0;
	}

	header h2 {
		font-size: var(--font-size-3);
		line-height: 1.1;
	}

	.editor-eyebrow {
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.icon-button {
		display: inline-grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		font-size: 1.1rem;
		line-height: 1;
	}

	.editor-body {
		display: grid;
		gap: var(--size-2);
		overflow: auto;
		padding: var(--size-3);
	}

	label {
		display: grid;
		gap: 0.35rem;
		margin: 0;
		font-weight: 700;
	}

	label span {
		font-size: var(--font-size-0);
	}

	input,
	textarea {
		width: 100%;
		margin: 0;
		font: inherit;
	}

	textarea {
		min-height: 13rem;
		resize: vertical;
	}

	.field-error {
		margin: 0;
		color: var(--red-8);
		font-size: var(--font-size-0);
		line-height: 1.35;
	}

	.journal-preview {
		display: grid;
		gap: var(--size-1);
		padding: var(--size-2);
		background: color-mix(in srgb, var(--nc-surface-2) 62%, transparent);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
	}

	.preview-empty {
		margin: 0;
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
	}

	.journal-rendered {
		display: grid;
		gap: 0.65rem;
		overflow-wrap: anywhere;
	}

	.journal-rendered :global(h2),
	.journal-rendered :global(h3),
	.journal-rendered :global(h4),
	.journal-rendered :global(p),
	.journal-rendered :global(ul),
	.journal-rendered :global(ol),
	.journal-rendered :global(blockquote),
	.journal-rendered :global(pre) {
		margin: 0;
	}

	.journal-rendered :global(h2),
	.journal-rendered :global(h3),
	.journal-rendered :global(h4) {
		font-size: var(--font-size-2);
		line-height: 1.2;
	}

	.journal-rendered :global(code),
	.journal-rendered :global(pre) {
		font-family: var(--font-mono), monospace;
	}

	.journal-rendered :global(code) {
		padding: 0.08em 0.28em;
		background: var(--nc-surface-1);
		border: 1px solid var(--nc-border);
		border-radius: calc(var(--nc-radius) * 0.6);
		font-size: 0.9em;
	}

	.journal-rendered :global(pre) {
		overflow: auto;
		padding: var(--size-2);
		background: var(--nc-surface-1);
		border: 1px solid var(--nc-border);
		border-radius: var(--nc-radius);
	}

	.journal-rendered :global(pre code) {
		padding: 0;
		background: transparent;
		border: 0;
	}

	.journal-rendered :global(blockquote) {
		padding-inline-start: var(--size-2);
		color: var(--nc-tx-2);
		border-inline-start: 3px solid var(--nc-border);
	}

	footer {
		border-block-start: 1px solid var(--nc-border);
	}

	.footer-spacer {
		flex: 1 1 auto;
	}

	button {
		margin: 0;
	}

	.danger-confirm {
		color: var(--red-9);
		border-color: var(--red-6);
	}

	@media (max-width: 520px) {
		.journal-entry-editor-backdrop {
			align-items: end;
			padding: var(--size-1);
			padding-block-end: 0;
		}

		.journal-entry-editor {
			width: 100%;
			max-height: calc(100dvh - var(--size-2));
			border-end-start-radius: 0;
			border-end-end-radius: 0;
		}

		header,
		.editor-body,
		footer {
			padding: var(--size-2);
		}

		header h2 {
			font-size: var(--font-size-2);
		}

		footer {
			flex-wrap: wrap;
		}
	}
</style>
