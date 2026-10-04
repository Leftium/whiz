<script lang="ts">
	import { page } from '$app/state';
	import CompromiseInspector, {
		getInspectPanelId
	} from '#lib/components/CompromiseInspector.svelte';
	import LauncherPage from '#lib/components/LauncherPage.svelte';

	const urlText = $derived(page.url.searchParams.get('q') ?? '');
	const inspect = $derived(getInspectPanelId(page.url.searchParams.get('inspect')));
	const expression = $derived(page.url.searchParams.get('expr') ?? undefined);
	let text = $derived(urlText);
</script>

<LauncherPage modeId="compromise" bind:value={text} />

<main class="nlp-inspector-shell">
	<CompromiseInspector {text} {inspect} {expression} />
</main>

<style>
	.nlp-inspector-shell {
		width: min(calc(var(--nc-content-width) + 2 * var(--nc-spacing)), 100%);
		margin-inline: auto;
		padding-inline: var(--nc-spacing);
		padding-block-end: var(--size-4);
	}
</style>
