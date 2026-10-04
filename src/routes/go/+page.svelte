<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	import { readExecutionSettings, readMyBangs } from '#lib/bang-data.js';
	import DefaultSearchSetup from '#lib/components/DefaultSearchSetup.svelte';
	import {
		getSearchUrl,
		hasBangToken,
		resolveBangExecutionWithExtendedFallback
	} from '#lib/launcher/bang-resolver.js';
	import {
		createBangSearchHistoryEvent,
		createPlainSearchHistoryEvent,
		recordSearchHistoryEvent,
		type SearchHistoryEvent
	} from '#lib/search-history.js';
	import { readStoredExecutionSettings } from '#lib/settings.svelte.js';
	import { loadShippedBangCatalog } from '#lib/shipped-bang-catalog.js';

	const query = page.url.searchParams.get('q')?.trim() ?? '';
	let errorMessage = $state('');
	let fanoutTargets = $state<string[]>([]);
	const fanoutAckTimeoutMs = 2500;

	onMount(() => {
		if (!query) return;

		document.body.classList.add('go-executing');
		void executeQuery();

		return () => {
			document.body.classList.remove('go-executing');
		};
	});

	async function executeQuery() {
		try {
			const executionSettings =
				(await readExecutionSettings().catch(() => undefined)) ?? readStoredExecutionSettings();

			if (!hasBangToken(query)) {
				const targetUrl = getSearchUrl(
					executionSettings.searchProvider,
					query,
					executionSettings.customSearchTemplate
				);

				await recordGoHistoryEvent(
					createPlainSearchHistoryEvent({
						source: 'omnibar',
						rawQuery: query,
						settings: executionSettings,
						targetUrl
					})
				);
				window.location.replace(targetUrl);
				return;
			}

			const [myBangs, catalogResult] = await Promise.all([
				readMyBangs().catch(() => []),
				loadShippedBangCatalog(executionSettings.bangProvider)
			]);
			const popularProviderBangs = catalogResult.error ? [] : catalogResult.data.items;
			const { result } = await resolveBangExecutionWithExtendedFallback(
				query,
				myBangs,
				popularProviderBangs,
				executionSettings,
				{
					loadExtendedBangs: async () => {
						const extendedResult = await loadShippedBangCatalog(
							executionSettings.bangProvider,
							'extended'
						);

						return extendedResult.error ? undefined : extendedResult.data.items;
					}
				}
			);

			await recordGoHistoryEvent(
				createBangSearchHistoryEvent({
					source: 'omnibar',
					rawQuery: query,
					settings: executionSettings,
					composition: result.composition,
					targetUrls: result.targetUrls
				})
			);

			if (result.targetUrls.length <= 1) {
				window.location.replace(result.targetUrl);
				return;
			}

			fanoutTargets = result.targetUrls;
			document.body.classList.remove('go-executing');

			if (!(await openSecondaryTargets(result.targetUrls))) {
				return;
			}

			window.location.replace(result.targetUrl);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		}
	}

	async function recordGoHistoryEvent(event: SearchHistoryEvent) {
		try {
			await recordSearchHistoryEvent(event);
		} catch (error) {
			console.warn('Failed to record search history', error);
		}
	}

	function openSecondaryTargets(targetUrls: string[]) {
		if (!('BroadcastChannel' in window)) {
			errorMessage = 'Could not confirm secondary bang targets opened in this browser.';
			return Promise.resolve(false);
		}

		const channelName = `go-fanout-${crypto.randomUUID()}`;
		const expectedCount = targetUrls.length - 1;
		const acknowledged = Array.from({ length: expectedCount }, () => false);
		let acknowledgedCount = 0;
		const channel = new BroadcastChannel(channelName);

		return new Promise<boolean>((resolve) => {
			const finish = (success: boolean) => {
				clearTimeout(timeout);
				channel.close();

				if (!success) {
					errorMessage = 'Could not open secondary bang targets. Check popup permissions for Whiz.';
				}

				resolve(success);
			};

			const timeout = window.setTimeout(
				() => finish(acknowledgedCount === expectedCount),
				fanoutAckTimeoutMs
			);

			channel.onmessage = (event: MessageEvent<{ index?: number }>) => {
				const index = event.data.index;

				if (typeof index !== 'number' || index < 1 || index > expectedCount) {
					return;
				}

				if (acknowledged[index - 1]) return;

				acknowledged[index - 1] = true;
				acknowledgedCount += 1;

				if (acknowledgedCount === expectedCount) {
					finish(true);
				}
			};

			for (const [offset, targetUrl] of targetUrls.slice(1).entries()) {
				const relayUrl = new URL('/go/open', window.location.href);

				relayUrl.searchParams.set('target', targetUrl);
				relayUrl.searchParams.set('channel', channelName);
				relayUrl.searchParams.set('index', String(offset + 1));

				window.open(relayUrl.toString(), '_blank', 'noopener,noreferrer');
			}
		});
	}

	function getTargetLabel(targetUrl: string) {
		try {
			return new URL(targetUrl).hostname.replace(/^www\./, '');
		} catch {
			return targetUrl;
		}
	}

	function getTargetLinkAttributes(targetUrl: string, index: number) {
		return {
			href: targetUrl,
			target: index === 0 ? undefined : '_blank',
			rel: index === 0 ? undefined : 'noopener noreferrer',
			title: targetUrl
		};
	}
</script>

<svelte:head>
	<title>{query ? 'Executing search' : 'Default search setup'} | Whiz</title>
</svelte:head>

{#if fanoutTargets.length}
	<main class="fanout-page" aria-live="polite">
		<p class="eyebrow">Opening multiple bangs</p>
		<h1>Whiz is opening your bang targets</h1>
		<p>
			If this page stays open, your browser probably blocked popup tabs. Use the popup-blocked icon
			in the address bar to allow popups for Whiz, then retry the omnibar search.
		</p>
		{#if errorMessage}
			<p class="error">{errorMessage}</p>
		{/if}
		<ol>
			{#each fanoutTargets as targetUrl, index (`${index}-${targetUrl}`)}
				<li>
					<span class="target-row">
						<span class="target-context">{index === 0 ? 'Current tab' : `New tab ${index}`}:</span>
						<a {...getTargetLinkAttributes(targetUrl, index)} class="target-link">
							<span class="target-host">{getTargetLabel(targetUrl)}</span>
							<span class="target-url">{targetUrl}</span>
						</a>
					</span>
				</li>
			{/each}
		</ol>
	</main>
{:else if query}
	<main class="go-status" aria-live="polite">
		<p>Executing search...</p>
		<p class="query">{query}</p>
		{#if errorMessage}
			<p class="error">Could not execute this search: {errorMessage}</p>
		{/if}
	</main>
{:else}
	<main>
		<DefaultSearchSetup />
	</main>
{/if}

<style>
	:global(body.go-executing) {
		--nc-content-shadow: none;

		padding-block: 0;
	}

	:global(body:has(.go-status)) {
		--nc-content-shadow: none;

		padding-block: 0;
	}

	:global(body:has(.go-status)::before),
	:global(body.go-executing::before) {
		box-shadow: none !important;
	}

	.go-status {
		display: grid;
		gap: 0.25rem;
		justify-items: center;
		width: min(32rem, 100%);
		margin-inline: auto;
		padding: 0.35rem 0.5rem;
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
		line-height: 1.2;
		opacity: 0.72;
		text-align: center;
	}

	.go-status p {
		max-width: 100%;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.query {
		font-family: var(--font-mono), monospace;
		font-size: 0.82em;
		opacity: 0.72;
	}

	.error {
		color: var(--red-7);
		opacity: 1;
	}

	.fanout-page {
		display: grid;
		gap: 1rem;
		width: min(42rem, 100%);
		margin-inline: auto;
		padding: 2rem 1rem;
	}

	.fanout-page h1,
	.fanout-page p,
	.fanout-page ol {
		margin: 0;
	}

	.eyebrow {
		color: var(--nc-tx-2);
		font-size: var(--font-size-0);
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.fanout-page ol {
		display: grid;
		gap: 0.5rem;
		padding-left: 1.5rem;
	}

	.fanout-page li {
		min-width: 0;
	}

	.target-row {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.5rem;
		align-items: start;
		min-width: 0;
	}

	.target-context {
		color: var(--nc-tx-2);
		white-space: nowrap;
	}

	.target-link {
		display: grid;
		min-width: 0;
		max-width: 100%;
		color: var(--nc-lk-1);
		font: inherit;
		text-align: left;
		text-decoration: none;
	}

	.target-host,
	.target-url {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.target-host {
		text-decoration: underline;
	}

	.target-url {
		color: var(--nc-tx-2);
		font-family: var(--font-mono), monospace;
		font-size: var(--font-size-0);
		line-height: 1.25;
	}

	.target-link:hover .target-host,
	.target-link:focus .target-host {
		text-decoration-thickness: 0.12em;
	}
</style>
