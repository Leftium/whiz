<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { initSettings } from '#lib/settings.svelte.js';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		initSettings();

		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker.register(`${resolve('/')}service-worker.js`, { type: 'module' });
		}
	});
</script>

{@render children()}
