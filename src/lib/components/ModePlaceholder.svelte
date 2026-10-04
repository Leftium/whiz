<script lang="ts">
	import { resolve } from '$app/paths';
	import Header from '#lib/components/Header.svelte';
	import { getLauncherMode } from '#lib/launcher/modes.js';
	import type { LauncherModeId } from '#lib/launcher/types.js';

	let { modeId }: { modeId: LauncherModeId } = $props();
	const mode = $derived(getLauncherMode(modeId));
</script>

<main>
	<Header modeLabel={mode.label} />

	<section class="placeholder-panel">
		<p class="eyebrow">Launcher mode</p>
		<h1>{mode.label}</h1>
		<p>{mode.description}</p>
		<a class="secondary outline" href={resolve('/')}>Back to Everything</a>
	</section>
</main>

<style>
	main {
		width: min(calc(var(--nc-content-width) + 2 * var(--nc-spacing)), 100%);
		margin-inline: auto;
		padding-inline: var(--nc-spacing);
	}

	.placeholder-panel {
		display: grid;
		gap: var(--size-2);
		margin-block-start: var(--size-5);
		padding: var(--size-4);
		border: 1px solid var(--nc-border);
		border-radius: var(--radius-3);
		background: var(--nc-surface-1);
	}

	.eyebrow {
		margin: 0;
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	h1,
	p {
		margin: 0;
	}

	a {
		justify-self: start;
	}
</style>
