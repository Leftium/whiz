<script lang="ts">
	import type { BangProviderId } from '#lib/bang-data.js';
	import Header from '#lib/components/Header.svelte';
	import {
		setBangProvider,
		setColorScheme,
		setSearchProvider,
		settings,
		type ColorScheme,
		type SearchProvider
	} from '#lib/settings.svelte.js';

	const searchProviders: { value: SearchProvider; label: string }[] = [
		{ value: 'kagi', label: 'Kagi' },
		{ value: 'duckduckgo', label: 'DuckDuckGo' },
		{ value: 'google', label: 'Google' },
		{ value: 'custom', label: 'Custom' }
	];

	const colorSchemes: { value: ColorScheme; label: string }[] = [
		{ value: '', label: 'Auto (System)' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'light', label: 'Light' }
	];

	const BANG_CATALOGS: { value: BangProviderId; label: string }[] = [
		{ value: 'kagi', label: 'Kagi' },
		{ value: 'duckduckgo', label: 'DuckDuckGo' }
	];
</script>

<main>
	<Header />

	<section aria-labelledby="settings-heading">
		<h1 id="settings-heading">Settings</h1>

		<fieldset class="setting provider-setting">
			<legend>Color scheme</legend>

			<div class="providers">
				{#each colorSchemes as colorScheme (colorScheme.value)}
					<label>
						<input
							type="radio"
							name="color-scheme"
							value={colorScheme.value}
							checked={settings.colorScheme === colorScheme.value}
							onchange={() => setColorScheme(colorScheme.value)}
						/>
						<span>{colorScheme.label}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<fieldset class="setting provider-setting">
			<legend>Search engine</legend>

			<div class="providers">
				{#each searchProviders as provider (provider.value)}
					<label>
						<input
							type="radio"
							name="search-provider"
							value={provider.value}
							checked={settings.searchProvider === provider.value}
							onchange={() => setSearchProvider(provider.value)}
						/>
						<span>{provider.label}</span>
					</label>
				{/each}
			</div>
		</fieldset>

		<fieldset class="setting provider-setting">
			<legend>Bang engine</legend>

			<div class="providers">
				{#each BANG_CATALOGS as provider (provider.value)}
					<label>
						<input
							type="radio"
							name="bang-provider"
							value={provider.value}
							checked={settings.bangProvider === provider.value}
							onchange={() => setBangProvider(provider.value)}
						/>
						<span>{provider.label}</span>
					</label>
				{/each}
			</div>
		</fieldset>
	</section>
</main>

<style>
	main {
		box-sizing: border-box;
		width: min(calc(var(--nc-content-width) + 2 * var(--nc-spacing)), 100%);
		margin-inline: auto;
		padding-inline: var(--nc-spacing);
	}

	main > section {
		display: grid;
		gap: var(--size-4);
		margin-block-start: var(--size-5);
	}

	h1 {
		margin: 0;
		font-size: var(--font-size-4);
	}

	legend {
		font-size: var(--font-size-1);
		font-weight: var(--font-weight-7);
	}

	.setting {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--size-3);
		padding: var(--size-2) var(--size-3);
		border: var(--border-size-1) solid var(--gray-7);
		border-radius: var(--radius-2);
		font-size: var(--font-size-0);
	}

	.provider-setting {
		align-items: flex-start;
		flex-direction: column;
		margin: 0;
	}

	.providers {
		display: grid;
		gap: var(--size-1);
	}

	label {
		display: flex;
		align-items: center;
		gap: var(--size-1);
		font-size: var(--font-size-0);
	}

	input[type='radio'] {
		width: 0.9rem;
		height: 0.9rem;
	}

	@media (max-width: 40rem) {
		.setting {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
