<script module lang="ts">
	import type { MyBangRecord as EditorMyBangRecord } from '#lib/bang-data.js';
	import type { SharedMyBangDraft } from '#lib/launcher/mybang-share.js';

	export type MyBangEditorSession = {
		key: string;
		item?: EditorMyBangRecord;
		draft?: SharedMyBangDraft;
		showValidation?: boolean;
		source?: 'share';
	};

	export type MyBangEditorSave = SharedMyBangDraft & {
		item?: EditorMyBangRecord;
	};
</script>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { tick } from 'svelte';

	import type { BangProviderId, MyBangRecord, ZbangRecord } from '#lib/bang-data.js';
	import {
		formatBangCodes,
		normalizeBangCode,
		parseBangCodeInput
	} from '#lib/launcher/bang-code.js';
	import type { LauncherHref } from '#lib/launcher/types.js';

	type FieldName = 'name' | 'codes' | 'urlTemplate';
	type ValidationErrors = Partial<Record<FieldName, string>>;

	let {
		session,
		myBangs,
		providerBangs,
		getShareHref,
		onSave,
		onShare,
		onCancel,
		onDelete
	}: {
		session: MyBangEditorSession;
		myBangs: MyBangRecord[];
		providerBangs: ZbangRecord[];
		getShareHref: (draft: SharedMyBangDraft) => LauncherHref | undefined;
		onSave: (draft: MyBangEditorSave) => void | Promise<void>;
		onShare: (draft: SharedMyBangDraft) => void | Promise<void>;
		onCancel: () => void;
		onDelete: (item: MyBangRecord) => void | Promise<void>;
	} = $props();

	const providerLabels: Record<BangProviderId, string> = {
		kagi: 'Kagi',
		duckduckgo: 'DuckDuckGo'
	};

	let activeSessionKey = $state('');
	let name = $state('');
	let codesText = $state('');
	let urlTemplate = $state('');
	let initialSnapshot = $state('');
	let submitAttempted = $state(false);
	let deleteConfirm = $state(false);
	let saving = $state(false);
	let nameInput = $state<HTMLInputElement>();
	let codesInput = $state<HTMLInputElement>();
	let urlInput = $state<HTMLTextAreaElement>();

	const editorTitleId = $derived(
		`mybang-editor-title-${session.key.replace(/[^a-z0-9_-]/gi, '-')}`
	);
	const parsedCodes = $derived(parseBangCodeInput(codesText));
	const validationErrors = $derived(getValidationErrors());
	const firstInvalidField = $derived(getFirstInvalidField(validationErrors));
	const shareDraft = $derived(getShareDraft());
	const shareHref = $derived(isDraftShareable() ? getShareHref(shareDraft) : undefined);
	const providerWarnings = $derived(getProviderWarnings(parsedCodes.codes));
	const urlWarnings = $derived(getUrlWarnings(urlTemplate.trim()));
	const dirty = $derived(getDraftSnapshot() !== initialSnapshot);
	const sourceDetails = $derived(getSourceDetails(session.item));

	$effect(() => {
		if (session.key === activeSessionKey) return;

		activeSessionKey = session.key;
		name = session.draft?.name ?? session.item?.name ?? '';
		codesText = session.draft
			? formatBangCodes(session.draft.code)
			: session.item
				? formatBangCodes(session.item.code)
				: '';
		urlTemplate = session.draft?.urlTemplate ?? session.item?.urls.s ?? '';
		initialSnapshot = getDraftSnapshot();
		submitAttempted = Boolean(session.showValidation);
		deleteConfirm = false;
		saving = false;

		void tick().then(() => focusField(getFirstInvalidField(getValidationErrors()) ?? 'name'));
	});

	function getValidationErrors(): ValidationErrors {
		const errors: ValidationErrors = {};

		if (!name.trim()) {
			errors.name = 'Name is required.';
		}

		if (parsedCodes.invalidTokens.length) {
			errors.codes = `Invalid code: ${parsedCodes.invalidTokens.join(' ')}.`;
		} else if (!parsedCodes.codes.length) {
			errors.codes = 'At least one code is required.';
		} else if (parsedCodes.duplicateCodes.length) {
			errors.codes = `Duplicate code: ${formatBangCodes(parsedCodes.duplicateCodes)}.`;
		} else {
			const conflictingCodes = getConflictingCodes(parsedCodes.codes);

			if (conflictingCodes.length) {
				errors.codes = `Already used by another MyBang: ${formatBangCodes(conflictingCodes)}.`;
			}
		}

		const urlError = getUrlError(urlTemplate.trim());
		if (urlError) errors.urlTemplate = urlError;

		return errors;
	}

	function getFirstInvalidField(errors: ValidationErrors): FieldName | undefined {
		if (errors.name) return 'name';
		if (errors.codes) return 'codes';
		if (errors.urlTemplate) return 'urlTemplate';

		return undefined;
	}

	function getShareDraft(): SharedMyBangDraft {
		return {
			name: name.trim(),
			code: parsedCodes.codes,
			urlTemplate: urlTemplate.trim()
		};
	}

	function isDraftShareable() {
		return (
			Boolean(name.trim()) &&
			parsedCodes.codes.length > 0 &&
			parsedCodes.invalidTokens.length === 0 &&
			parsedCodes.duplicateCodes.length === 0 &&
			!getUrlError(urlTemplate.trim())
		);
	}

	function getUrlError(value: string) {
		if (!value) return 'URL template is required.';

		try {
			const url = new URL(value);

			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				return 'URL template must start with http:// or https://.';
			}
		} catch {
			return 'URL template must be an absolute URL.';
		}

		return undefined;
	}

	function getUrlWarnings(value: string) {
		if (!value || getUrlError(value) || value.includes('%s')) return [];

		return ['This URL does not include %s, so search text will not be inserted.'];
	}

	function getConflictingCodes(codes: string[]) {
		const currentId = session.item?.id;

		return codes.filter((code) =>
			myBangs.some(
				(item) =>
					item.id !== currentId &&
					item.code.some((itemCode) => normalizeBangCode(itemCode) === code)
			)
		);
	}

	function getProviderWarnings(codes: string[]) {
		if (!codes.length) return [];

		const codeSet = new Set(codes);
		const overlapping = providerBangs.filter((item) =>
			item.code.some((code) => codeSet.has(normalizeBangCode(code)))
		);

		if (!overlapping.length) return [];

		const names = overlapping
			.slice(0, 3)
			.map((item) => item.name)
			.join(', ');
		const suffix = overlapping.length > 3 ? ` and ${overlapping.length - 3} more` : '';

		return [
			`This MyBang will take precedence over provider bang${overlapping.length === 1 ? '' : 's'}: ${names}${suffix}.`
		];
	}

	function getSourceDetails(item: MyBangRecord | undefined) {
		if (!item || item.origin !== 'catalog') return [];

		return [
			item.sourceProvider ? `Provider: ${providerLabels[item.sourceProvider]}` : undefined,
			item.sourceName ? `Source: ${item.sourceName}` : undefined,
			item.sourceCodes?.length ? `Codes: ${formatBangCodes(item.sourceCodes)}` : undefined,
			item.sourceDomain ? `Domain: ${item.sourceDomain}` : undefined
		].filter((detail): detail is string => Boolean(detail));
	}

	function getDraftSnapshot() {
		return JSON.stringify({
			name: name.trim(),
			codesText: codesText.trim(),
			urlTemplate: urlTemplate.trim()
		});
	}

	function focusField(field: FieldName) {
		if (field === 'name') nameInput?.focus();
		if (field === 'codes') codesInput?.focus();
		if (field === 'urlTemplate') urlInput?.focus();
	}

	function requestCancel() {
		if (!dirty || confirm('Discard unsaved MyBang changes?')) {
			onCancel();
		}
	}

	async function submitEditor(event: SubmitEvent) {
		event.preventDefault();
		submitAttempted = true;

		if (firstInvalidField) {
			focusField(firstInvalidField);
			return;
		}

		saving = true;

		try {
			await onSave({
				item: session.item,
				name: name.trim(),
				code: parsedCodes.codes,
				urlTemplate: urlTemplate.trim()
			});
		} finally {
			saving = false;
		}
	}

	async function shareEditorDraft(event: MouseEvent) {
		event.preventDefault();

		if (!isDraftShareable()) {
			submitAttempted = true;
			focusField(getFirstInvalidField(getValidationErrors()) ?? 'name');
			return;
		}

		await onShare(shareDraft);
	}

	async function requestDelete() {
		if (!session.item) return;

		if (!deleteConfirm) {
			deleteConfirm = true;
			return;
		}

		saving = true;

		try {
			await onDelete(session.item);
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
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="mybang-editor-backdrop" onclick={handleBackdropClick} role="presentation">
	<div class="mybang-editor" role="dialog" aria-modal="true" aria-labelledby={editorTitleId}>
		<form onsubmit={submitEditor}>
			<header>
				<div>
					<p class="editor-eyebrow">MyBang</p>
					<h2 id={editorTitleId}>{session.item ? 'Edit MyBang' : 'New custom bang'}</h2>
				</div>
				<button type="button" class="icon-button" aria-label="Close editor" onclick={requestCancel}>
					x
				</button>
			</header>

			<div class="editor-body">
				<label>
					<span>Name</span>
					<input
						bind:this={nameInput}
						bind:value={name}
						aria-invalid={Boolean(validationErrors.name)}
						aria-describedby={validationErrors.name ? 'mybang-name-error' : undefined}
					/>
				</label>
				{#if submitAttempted && validationErrors.name}
					<p class="field-error" id="mybang-name-error">{validationErrors.name}</p>
				{/if}

				<label>
					<span>Codes</span>
					<input
						bind:this={codesInput}
						bind:value={codesText}
						aria-invalid={Boolean(validationErrors.codes)}
						aria-describedby={validationErrors.codes ? 'mybang-codes-error' : undefined}
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
					/>
				</label>
				{#if submitAttempted && validationErrors.codes}
					<p class="field-error" id="mybang-codes-error">{validationErrors.codes}</p>
				{/if}

				<label>
					<span>URL template</span>
					<textarea
						bind:this={urlInput}
						bind:value={urlTemplate}
						aria-invalid={Boolean(validationErrors.urlTemplate)}
						aria-describedby={validationErrors.urlTemplate ? 'mybang-url-error' : undefined}
						rows="3"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"></textarea>
				</label>
				{#if submitAttempted && validationErrors.urlTemplate}
					<p class="field-error" id="mybang-url-error">{validationErrors.urlTemplate}</p>
				{/if}

				{#if providerWarnings.length || urlWarnings.length}
					<div class="editor-warnings" aria-live="polite">
						{#each [...providerWarnings, ...urlWarnings] as warning (warning)}
							<p>{warning}</p>
						{/each}
					</div>
				{/if}

				{#if sourceDetails.length}
					<div class="source-details">
						{#each sourceDetails as detail (detail)}
							<span>{detail}</span>
						{/each}
					</div>
				{/if}
			</div>

			<footer>
				{#if session.item}
					<button type="button" class:danger-confirm={deleteConfirm} onclick={requestDelete}>
						{deleteConfirm ? 'Confirm delete' : 'Delete'}
					</button>
				{/if}
				<span class="footer-spacer"></span>
				{#if shareHref}
					<a class="editor-share-link" href={resolve(shareHref)} onclick={shareEditorDraft}>
						Share
					</a>
				{:else}
					<button type="button" disabled>Share</button>
				{/if}
				<button type="button" onclick={requestCancel}>Cancel</button>
				<button type="submit" disabled={saving}>Save</button>
			</footer>
		</form>
	</div>
</div>

<style>
	.mybang-editor-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: var(--size-3);
		background: rgb(0 0 0 / 0.36);
	}

	.mybang-editor {
		width: min(36rem, 100%);
		max-height: min(90dvh, 44rem);
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
		min-height: 5.25rem;
		resize: vertical;
	}

	.field-error,
	.editor-warnings p {
		margin: 0;
		font-size: var(--font-size-0);
		line-height: 1.35;
	}

	.field-error {
		color: var(--red-8);
	}

	.editor-warnings {
		display: grid;
		gap: 0.35rem;
		padding: var(--size-2);
		color: var(--nc-tx-1);
		background: color-mix(in srgb, var(--yellow-2) 70%, var(--nc-surface-1));
		border: 1px solid var(--yellow-6);
		border-radius: var(--nc-radius);
	}

	.source-details {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.source-details span {
		padding: 0.2rem 0.45rem;
		color: var(--nc-tx-2);
		background: var(--nc-surface-2);
		border: 1px solid var(--nc-border);
		border-radius: calc(var(--nc-radius) * 0.65);
		font-size: var(--font-size-0);
		line-height: 1.2;
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

	.editor-share-link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		margin: 0;
		min-height: 2.25rem;
		padding: 0.35rem 0.75rem;
		color: var(--buttonText);
		background: var(--buttonBg);
		border: 1px solid var(--buttonBorder);
		border-radius: var(--nc-radius);
		font-weight: 700;
		line-height: 1.2;
		text-decoration: none;
		box-shadow: var(--buttonShadow);
	}

	.editor-share-link:hover,
	.editor-share-link:focus {
		text-decoration: none;
	}

	.danger-confirm {
		color: var(--red-9);
		border-color: var(--red-6);
	}

	@media (max-width: 520px) {
		.mybang-editor-backdrop {
			align-items: end;
			padding: var(--size-1);
			padding-block-end: 0;
		}

		.mybang-editor {
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
