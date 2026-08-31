# Search Date Filters

**Date**: 2026-08-31
**Status**: In Progress

## One Sentence

Whiz should recognize date-shaped `before:YYYY-MM-DD` and `after:YYYY-MM-DD` modifiers at the search-provider boundary, preserve the user's raw query, and translate the modifiers only when the selected provider has a verified date-filter mechanism.

## Overview

Today Whiz sends the complete query to the selected search provider. That works for Google, which understands `before:` and `after:` in the query itself, but Kagi expects explicit `from_date` and `to_date` URL parameters. Whiz should add a small, provider-aware query parser in front of URL construction so the same input works through the launcher, `/go`, and the service worker.

The first release is complete when:

- `release notes after:2025-01-01 before:2026-01-01` produces a filtered Kagi URL with a clean `q` value plus `from_date` and `to_date`.
- The same query remains intact for Google, DuckDuckGo, and custom providers unless a verified adapter says otherwise.
- Plain searches, forwarded bang searches, launcher execution, `/go`, and service-worker redirects resolve identically.
- Tokens that do not match the supported shape remain literal query text.

## Scope

In scope:

- Recognize unquoted, whitespace-delimited `before:YYYY-MM-DD` and `after:YYYY-MM-DD` modifiers, case-insensitively.
- Pass date-shaped values through without calendar or range validation.
- Translate recognized filters for Kagi.
- Preserve Google-native operator syntax.
- Preserve unsupported-provider syntax as literal query text.
- Apply the same resolution in every path that calls `getSearchUrl()`.
- Keep raw history and query reuse unchanged.
- Add focused automated coverage and a small browser smoke test.

Out of scope:

- Natural-language dates such as `after:yesterday` or `before:last March`.
- Partial dates such as `before:2025` or `after:2025-06`.
- Relative windows already covered by provider bangs such as Kagi's `!week` and `!month`.
- Changing provider bang templates or generated catalogs.
- Applying Whiz date filters to known local or provider bang targets.
- Adding date controls, a date picker, or persisted filter state.

## Current State

`src/lib/launcher/bang-resolver.ts` owns shared search URL construction:

```txt
getSearchUrl(provider, raw query, custom template)
  -> trim and encode the entire query
    -> build Kagi, DuckDuckGo, Google, or custom URL
```

The function is already shared by the important execution paths:

- `src/lib/components/LauncherPage.svelte` opens normal launcher searches.
- `src/routes/go/+page.svelte` resolves browser omnibar searches when the page handles `/go`.
- `src/service-worker.ts` resolves `/go` directly when mirrored settings are available.
- `getBangExecutionTargetUrls()` sends unresolved bang tokens through the selected search provider.

Bang composition in `src/lib/launcher/bang-composition.ts` removes resolved bang tokens and creates `payloadText`. Known bang targets receive that payload directly through their own templates. This is a useful boundary: date-filter translation belongs in `getSearchUrl()`, not in bang composition, because only search-provider targets should receive provider-specific filter behavior.

Search history in `src/lib/search-history.ts` already stores both the raw query and resolved target URLs. No history schema migration is needed. Reusing a query should restore the original `before:` and `after:` text.

Whiz already initializes `compromise-dates`, but its current role is extracting text signals. It is not needed for the canonical ISO-only syntax in this release.

## Target Design

### Parsed representation

Add a small pure module, `src/lib/launcher/search-date-filters.ts`:

```ts
type SearchDateFilters = {
	before?: string;
	after?: string;
};

type ParsedSearchDateFilters = {
	queryWithoutFilters: string;
	filters: SearchDateFilters;
};

parseSearchDateFilters(query: string): ParsedSearchDateFilters;
```

The parser should not know about Kagi, Google, or URL templates. It should only identify recognized modifiers and return the remaining search text.

### Parsing rules

- Match complete, unquoted tokens only: `before:2025-12-31` and `after:2025-01-01`.
- Match operator names case-insensitively, but normalize stored dates to `YYYY-MM-DD`.
- Require the zero-padded `YYYY-MM-DD` shape, but do not validate whether the date exists. For example, pass `before:2025-99-99` to Kagi as `to_date=2025-99-99`.
- Do not recognize tokens inside double-quoted phrases. Single quotes are ordinary query characters so apostrophes do not require special handling.
- Use the last recognized occurrence of each operator. Remove all recognized occurrences from `queryWithoutFilters` so no superseded filter leaks into Kagi's `q` parameter.
- Leave tokens with a different shape, such as `before:2025`, `before:`, or `before:2025-1-01`, in the query as literal text.
- Do not compare `after` and `before`. Pass both values through even when the range appears inverted or equal.
- Join the remaining whitespace-delimited tokens with single spaces. Existing queries without recognized filters continue through the current URL-building path unchanged.

The names follow familiar search syntax, but the first release should treat them as provider filter bounds rather than promise cross-provider inclusive or exclusive semantics. The generated URL delegates boundary interpretation to the provider.

### Provider policy

Extend URL construction around a provider-specific policy:

| Provider | Query sent | Date transport |
| --- | --- | --- |
| Kagi | `queryWithoutFilters` | `after` -> `from_date`; `before` -> `to_date` |
| Google | Original raw query | Native `after:` and `before:` operators |
| DuckDuckGo | Original raw query | No translation in the first release |
| Custom | Original raw query | No translation in the first release |

For Kagi, keep the existing URL unchanged when no filter is recognized. When a filter is recognized, construct the query string with `URLSearchParams`:

```txt
raw query
  -> parseSearchDateFilters
    -> Kagi adapter removes recognized modifiers from q
      -> adds from_date and/or to_date
        -> final target URL
```

If the Kagi query contains only date filters, omit `q` and pass the date parameters as given. Do not invent search text or add a separate fallback policy.

For Google, retaining the raw query is both simpler and aligned with Google's documented operator support. DuckDuckGo documents custom date ranges in its UI but does not document a stable URL contract for these operators. Custom templates expose only `%s`, so Whiz cannot safely add provider-specific parameters. Both therefore keep the literal query until a verified adapter is added.

### Bang behavior

Date filters should affect only URLs built through `getSearchUrl()`:

- Plain search: apply the selected provider policy.
- Unknown or forwarded bang: apply the selected provider policy to the fallback search target.
- Known MyBang or provider bang: leave `before:` and `after:` in `payloadText`; the target site decides what they mean.
- Fanout containing local and forwarded targets: local targets keep literal modifier text, while the forwarded search-provider target applies its provider policy.

This avoids modifying user-authored MyBang templates and keeps catalog execution provider-native.

### History and display

Continue storing `rawQuery` exactly as entered and the final resolved target URL. No new history fields are required for the first release.

Shared Whiz URLs may include the original modifiers in their incoming `q` parameter. The shared resolver applies the provider policy when that URL executes, so sharing does not require pre-translating the query.

Do not add launcher chips or rewrite the visible input yet. The URL builder is the source of execution truth, and raw-query reuse remains lossless. A later UI pass may expose recognized filters after the execution behavior is stable.

## Design Decisions

| Decision | Class | Choice | Rationale |
| --- | --- | --- | --- |
| Ownership | Design coherence | Parse at the shared search URL boundary | All plain and forwarded provider searches already converge on `getSearchUrl()`. |
| Initial grammar | Taste under constraints | Zero-padded `YYYY-MM-DD` shape only | It is deterministic, locale-independent, and easy to recognize. |
| Date validation | Taste under constraints | Do not validate calendar dates or ranges | Kagi owns the date semantics; Whiz only translates syntax. |
| Nonmatching input | Design coherence | Preserve it literally | Tokens outside the supported shape remain ordinary query text. |
| Kagi transport | Evidence | Use `from_date` and `to_date` URL parameters | Kagi's current internal `!years` bang uses these parameters. |
| Google transport | Evidence | Preserve native operators in `q` | Google documents both operators and combined ranges. |
| DuckDuckGo and custom | Deferred | Preserve literal syntax | Add adapters only after a stable, documented parameter contract is verified. |
| Known bang targets | Design coherence | Do not translate | Their URL templates belong to the target service, not the selected fallback search provider. |
| NLP date parsing | Deferred | Do not use `compromise-dates` | Revisit when Whiz intentionally adds relative or natural-language filter syntax. |

## Implementation Plan

### Phase 1: Pure parsing and provider URL policy

- [x] Add `search-date-filters.ts` with double-quote-aware token scanning and last-occurrence duplicate handling.
- [x] Add a pure Kagi URL helper in the same module so parsing and Kagi URL generation can be tested without importing SvelteKit aliases.
- [x] Update the Kagi branch of `getSearchUrl()` to delegate to the helper. Leave the Google, DuckDuckGo, and custom branches structurally unchanged.
- [x] Build Kagi URLs with `URLSearchParams`, setting `q`, `from_date`, and `to_date` only when appropriate.
- [x] Keep the existing empty-query home-page behavior when no date modifiers are present.
- [x] Preserve existing URL output for every query without recognized date filters.
- [x] Keep Google, DuckDuckGo, and custom output byte-for-byte compatible apart from any encoding changes required by the refactor.

### Phase 2: Execution parity

- [ ] Confirm launcher plain searches use the updated shared builder without component-local parsing.
- [ ] Confirm `/go` page execution uses the same result.
- [ ] Confirm service-worker `/go` redirects use the same result and do not introduce browser-only imports into the shared module.
- [ ] Confirm forwarded bang targets use the filter-aware builder.
- [ ] Confirm known local bang targets still receive the literal payload.
- [ ] Confirm history records the raw query and the filtered target URL in launcher and omnibar flows.

### Phase 3: Verification and user guidance

- [x] Add focused `node:test` coverage for the pure parser and Kagi URL helper.
- [ ] Add examples to the existing default-search help or another established lightweight help surface only if users currently have a place to discover search syntax. Do not create a new help system for this feature.
- [ ] Run `npm run check` after implementation approval because the shared resolver is imported by Svelte components and the service worker.
- [ ] Perform one real-browser smoke pass for launcher and `/go` behavior after approval.

## Verification Matrix

At minimum, automate these cases:

| Input | Provider | Expected result |
| --- | --- | --- |
| `release notes after:2025-01-01` | Kagi | `q=release notes`, `from_date=2025-01-01` |
| `before:2026-01-01 release notes` | Kagi | `q=release notes`, `to_date=2026-01-01` |
| `release after:2025-01-01 notes before:2026-01-01` | Kagi | Clean `q` plus both parameters |
| `release notes after:2025-01-01` | Google | Original operator remains in `q` |
| `release notes after:2025-01-01` | DuckDuckGo | Original operator remains in `q` |
| `release notes after:2025-01-01` | Custom | Original operator is substituted into `%s` |
| `"before:2025-01-01" history` | Kagi | Quoted token remains literal; no date parameter |
| `before:2025-99-99 history` | Kagi | `q=history`, `to_date=2025-99-99` |
| `after:2026-01-01 before:2025-01-01 history` | Kagi | Both dates are passed through as parameters |
| `after:2025-01-01 after:2025-02-01 history` | Kagi | Last recognized `after` wins; both recognized tokens leave `q` |
| `!known history after:2025-01-01` | Known bang | Bang payload retains the modifier |
| `!unknown history after:2025-01-01` | Kagi fallback | Fallback query removes the modifier and adds `from_date` |
| `after:2025-01-01` | Kagi | `from_date=2025-01-01` with no `q` parameter |

Browser smoke checks:

1. Submit a filtered Kagi search from `/search` and inspect the destination URL.
2. Submit the same query through `/go?q=...` with and without an active service worker.
3. Reuse the recorded history item and confirm the original modifiers return to the launcher.

## Success Criteria

- [ ] Recognized date-shaped modifiers produce Kagi `from_date` and `to_date` parameters and are absent from Kagi's `q` value.
- [ ] Google retains its native modifier syntax.
- [ ] Unsupported providers never lose modifier text.
- [ ] Quoted and nonmatching tokens are not translated.
- [ ] Date-shaped values are passed through without calendar or range validation.
- [ ] Known bang payloads remain unchanged.
- [ ] Launcher, `/go`, and service-worker resolution produce the same URL for the same settings and input.
- [ ] Existing searches without recognized filters retain their current behavior.
- [ ] Raw history remains reusable and resolved target URLs remain inspectable.
- [ ] Focused automated tests and the approved proportional checks pass.

## Deferred Work

- Add verified DuckDuckGo or Brave/custom adapters.
- Support year-only, month-only, relative, or natural-language dates.
- Define an explicit inclusive/exclusive cross-provider date model if Whiz needs identical result boundaries across engines.
- Add filter chips, a date picker, autocomplete, or inline validation.
- Generalize the parser into a broader search-modifier framework only after a second modifier family proves the abstraction useful.

## References

- `src/lib/launcher/bang-resolver.ts` - Shared search URL construction and forwarded bang target resolution.
- `src/lib/launcher/bang-composition.ts` - Separation between known bang targets, forwarded bangs, and payload text.
- `src/lib/components/LauncherPage.svelte` - Launcher execution and history recording.
- `src/routes/go/+page.svelte` - Page-based omnibar execution.
- `src/service-worker.ts` - Service-worker omnibar execution.
- `src/lib/search-history.ts` - Raw query and resolved target persistence.
- `src/lib/compromise.ts` - Existing NLP date plugin initialization, intentionally outside the first release.
- `https://raw.githubusercontent.com/kagisearch/bangs/main/data/kagi_bangs.json` - Kagi's internal `!years` bang and current date parameter names.
- `https://support.google.com/websearch/answer/2466433` - Google's documented `before:` and `after:` operators.
- `https://duckduckgo.com/duckduckgo-help-pages/features/dates` - DuckDuckGo's documented date-filter UI without a stable operator or URL contract.
