<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { modeLabel }: { modeLabel?: string } = $props();

	const modeTitle = $derived(modeLabel === 'Everything' ? '' : (modeLabel ?? ''));
</script>

<header>
	<a class="brand" href={resolve('/')}>
		<span class="brand-secondary">whi</span><span class="brand-primary">z!</span>
		{#if modeTitle}
			<span class="mode-label">{modeTitle}</span>
		{/if}
	</a>

	{#if page.url.pathname !== resolve('settings/form')}
		<a class="secondary outline settings" href={resolve('settings/form')}>settings</a>
	{/if}
</header>

<style>
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		width: 100%;
		gap: var(--size-2);
	}

	span {
		font-size: var(--font-size-4);
		font-weight: var(--font-weight-9);
	}

	.brand-primary {
		color: #ff3e00;
	}

	.mode-label {
		color: rgb(255 62 0 / 0.76);
	}

	.brand-secondary {
		color: var(--gray-5);
	}

	a {
		text-decoration: none;
	}

	.brand {
		display: inline-flex;
		align-items: baseline;
		flex-wrap: wrap;
		line-height: var(--font-lineheight-1);
	}

	.settings {
		align-self: center;
		padding: var(--size-1);
		font-size: var(--font-size-0);
		font-weight: var(--font-weight-5);
		white-space: nowrap;
	}
</style>
