# Similarity pre-check: implementation and deployment

## What changed

- The local comparison uses normalized word shingles, catches exact text across capitalization/diacritic differences, and extends aligned passages across isolated substitutions plus short inserted/deleted phrases. Bridged or substituted words are not counted as matched tokens and are not highlighted as confirmed matches.
- Citation/quotation/bibliography grouping remains explicitly heuristic. It is not Turnitin's proprietary machine-learning classifier.
- The report supports a consent-gated public-source discovery pass. The authenticated server creates up to four short excerpt queries, searches Brave Web Search when configured, retrieves a bounded number of publicly accessible HTML/plain-text pages when permitted by the site's `robots.txt`, and searches Crossref metadata for records with readable abstracts.
- The server compares retrieved source text to the essay, then returns only match spans/snippets and source metadata. It does not return full retrieved page text to the browser and this feature does not intentionally persist the essay or source page text.
- Scholarly discovery queries Crossref and OpenAlex metadata/abstracts, tries a bounded set of robots-permitted OpenAlex open-access landing pages, searches Europe PMC for openly accessible biomedical/life-science papers, and queries arXiv for open preprints. Where available, Momentum attempts bounded, robots-permitted full-text HTML retrieval through ar5iv; full-text comparisons are labeled separately from abstract matches.
- The endpoint requires a valid Supabase access token and explicit consent, limits essay size and query/result counts, validates public destination hosts and redirects, blocks private-network addresses, caps page size, and uses request timeouts.
- Sources are labeled as full page, search snippet, scholarly abstract, or user-provided text. A match from a snippet/abstract is never presented as a full-page comparison.

## Enable public web search

Set `BRAVE_SEARCH_API_KEY` as a **server-side** environment variable in Vercel (Project → Settings → Environment Variables) and redeploy. Obtain a key from the Brave Search API dashboard and use an appropriate plan. Never expose the key with a `VITE_` prefix or place it in client code.

Without the key, Crossref scholarly metadata/abstract discovery still runs, but general public-web search is unavailable. Crossref records often do not contain abstracts; if there is no readable source text, no comparison can be performed for that record.

## Privacy and limits

- Local-only comparisons stay in the browser.
- When the student explicitly opts into discovery, the essay is sent to the Momentum server for a one-time comparison request; up to four short excerpts are used as search queries. Search providers process those queries under their own terms.
- This code does not intentionally save essay text, retrieved page text, or search queries. Production hosting, proxies, observability tools, and third-party providers may have their own operational logging/retention policies; review those separately before deployment.
- Public web discovery is limited to search results and accessible pages. Some pages block crawlers, require authentication, use scripts the extractor cannot read, or are paywalled. Scholarly abstracts are not full articles.
- This is not Turnitin and cannot access Turnitin's proprietary matching engine, institution settings, private repositories, or student-paper repository. It must not be described as an official or predictive Turnitin score.

## Verification status

- The similarity engine compiles in isolation with strict TypeScript checks.
- Fourteen custom runtime regression checks passed, covering exact matching, overlapping-source deduplication, case/diacritic normalization, edited passages, inserted words/phrases, precise highlighting, bibliography filtering, reordered passages with correct source excerpts, unrelated/repetitive text, and the three-word-anchor recall/false-positive boundary.
- TypeScript syntax/transpile checks passed for the four changed implementation/test files.
- The full application typecheck, Vitest suite, build, and lint were not completed: installing the project's dependencies timed out in this workspace, and the full typecheck reports missing `vite/client` and `vitest/globals` definitions. These checks still need to run in a dependency-installed environment.
- A deployed test with a configured Brave key is still required, along with confirmation that the Vercel server runtime supports DNS lookup and outbound requests. No live Brave/Crossref/OpenAlex/Europe PMC/arXiv integration test was possible in this workspace.

## Path to a genuine Turnitin report

Turnitin publishes a licensed Turnitin Core API for institutional/vendor integrations. Official documentation describes creating a submission, uploading a file, waiting for processing, requesting a Similarity Report, waiting for report processing, and opening a report-viewer URL. It requires a tenant-specific API URL/key and a compliant EULA flow; some repository options depend on licensing. See:

- https://developers.turnitin.com/turnitin-core-api/information-for-ithenticate-integrators
- https://guides.turnitin.com/hc/en-us/articles/24604061232909-Custom-API-scope-creation

This project does not pretend to call that API. Its detailed API reference is behind Turnitin developer login, and no authorized tenant URL/key or integration specification was supplied. If Momentum's owner obtains an authorized TCA integration and its documentation, the correct next step is to implement the official server-side submission/report lifecycle. Never place the institution's API secret in client-side code or a `VITE_` variable.

## Similarity-engine hardening update (October 2026)

- Added bounded bidirectional extension from exact word-shingle anchors. This recovers longer passages containing isolated substitutions and short inserted/deleted phrases while stopping at consecutive mismatch events and bounding the extension length for predictable runtime.
- Added a stricter three-word anchor tier (at most eight occurrences in a source) to recover long copied passages where frequent edits break every four-word shingle. Added regression coverage for this higher-recall path and for short common phrases that must remain below the minimum-match threshold.
- Kept score accounting token-exact: a substituted word can be included in the displayed passage span but is not counted as a matched word unless it actually matches.
- Changed document highlighting to use the exact matched token indexes instead of painting every word in a bridged display span. This avoids visually implying that a substituted word itself matched.
- Improved public-search query selection to rank sliding windows across the essay body, so distinctive wording later in a sentence can be searched instead of always querying only the first words of each sentence.
- Added OpenAlex abstract-inverted-index reconstruction, bounded attempts to retrieve readable open-access landing pages, and Europe PMC open-access full-text XML retrieval alongside Crossref and optional Brave web search.
- Kept complete matched-word indexes and source-level statistics for the overall score even when detailed passage payloads are capped, so the default score does not silently undercount just because the browser receives a limited number of highlight passages. Query windows are deduplicated and references are excluded.
- Added regression cases for multiple isolated edits, unrelated academic text, overlapping source attribution, and exact-token highlighting.

These improvements are independently implemented heuristics, not a claim of Turnitin-equivalent recall or score calibration. Before production use, run the full Vitest suite and build in an environment with the project's dependencies installed, then benchmark against a legally obtained and representative reference set. The repository in this workspace has no `package-lock.json` and dependencies were not installed here, so a full app build/test run is not available in this environment.

## Additional synthetic stress check (October 2026)

A deterministic 208-token repeated-passage stress case was run locally after enabling three-word anchors. Replacing every 10th, 7th, 5th, or 4th essay token produced 89.9%, 85.6%, 79.8%, and 75.0% matched-token coverage respectively; the unchanged case produced 100%. Replacing every 3rd token produced 0%, exposing a known recall boundary: if edits break every exact three-word anchor, this lexical matcher cannot recover the passage. This is a synthetic regression/stress test, **not** a benchmark against Turnitin or a claim of equivalent accuracy.

A separate local timing smoke test processed a 20,000-word essay against a 5,000-word synthetic source in about 66 ms in this workspace. That is a single machine-specific measurement, not a production latency guarantee. Full application build/test/lint and live provider integration remain unverified until dependencies and deployment credentials are available.
