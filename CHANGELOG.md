# Changelog

All notable changes to this project are documented in this file.

## v4.0.0

### Breaking

- `POST /jobs/top-x-similar-cover-letters` (`src/database/getTopXSimilarCoverLetters.ts`, its route registration in `app.ts`, and its test) is deleted. Ranking past cover letters against a job is no longer a separate call a client makes before picking IDs to generate from — it's folded into `POST /cover-letters/create/text`, which now ranks and generates in a single round trip. Any caller still hitting the old route now gets a 404 (closes #105).
- `POST /cover-letters/create/text`'s request/response shape changed accordingly. The request body no longer takes `coverLetterIds: string[]` (the caller no longer picks which past cover letters to use); it now takes an optional `x?: number`, defaulting to `3`, the number of top-ranked past cover letters to generate from. The response no longer includes `inputTokenCount` — that field reported token usage from the handler's own direct token-service call, which is gone along with the direct OpenAI call it measured. The response is now just `{ coverLetter: string }`.

### Changed

- `generateCoverLettersAsText.ts` now fetches every stored cover letter and hands both ranking and generation to the `cover-letter-generator` package, instead of doing a targeted Mongo lookup by `coverLetterIds` plus a direct `OpenAI().responses.create({ model: 'gpt-5.5', ... })` call built from a hand-assembled prompt: the package's `embedJob` embeds the target job, `getTopXSimilarCoverLetters` ranks the fetched letters against that embedding by weighted per-segment cosine similarity (`mainBody` dominant), and `generateCoverLetter` writes the new letter from the top `x` matches. This replaces the local `getTopXSimilarCoverLetters.ts`/`SEGMENT_SIMILARITY_WEIGHTS` ranking logic entirely, and drops the handler's own `jobToText` prompt-building and `fetchTokens` token-counting call. `generateCoverLettersAsText.ts` now also imports `embedJob`/`getTopXSimilarCoverLetters`/`generateCoverLetter` from `cover-letter-generator` statically at module scope, on the same reasoning as the v3.0.8/#111 entry below.
- Two new adapters in `coverLetterAdapters.ts` bridge this repo's stored representation and the package's `CoverLetter` type: `toGeneratorCoverLetter` converts a `StoredCoverLetter` (`embedding: TextEmbedding | null` per segment) to the package's `CoverLetter` (`embedding?: TextEmbedding`), the inverse of the existing `toStoredCoverLetter`/`toStoredCoverLetterSegment` adapters in `uploadCoverLetterAsText.ts`. `getGeneratorCoverLetterTextSegments` extracts plain text segments from a package `CoverLetter`, mirroring the (now-removed) `getCoverLetterTextSegments` but for the package's shape instead of `StoredCoverLetter`.
- Added `hasOptionalPositiveIntegerProp` (`requestBodyValidators.ts`) to validate the new `x` field: valid when absent, `undefined`, or a positive integer. Its first version returned `false` whenever the key was absent from the request body at all (as opposed to present with an explicit `undefined` value) — which would have 400'd the expected common case, a real JSON body simply omitting `x` to take its default of `3`. Fixed to return `true` when the key is absent, matching the field's optionality.

### Removed

- `getCoverLetterTextSegments` (`coverLetterAdapters.ts`) — the ranking/generation fusion left it with no remaining callers, since `generateCoverLettersAsText.ts` now works with the package's `CoverLetter` type via `getGeneratorCoverLetterTextSegments` instead of `StoredCoverLetter` directly.

## v3.0.8

### Changed

- `uploadCoverLetterAsText.ts` now imports `segmentCoverLetter` and `embedCoverLetterSegments` from `cover-letter-generator` statically at module scope again, instead of the `await import('cover-letter-generator')` dynamic import inside the request handler added by #103/v3.0.6. `coverLetterAdapters.ts` now imports `COVER_LETTER_SEGMENT_NAMES` as a value from the package too, instead of hardcoding its own duplicate copy of the 6 segment names — that duplication, and the comment explaining it, existed solely to avoid triggering the package's eager `new OpenAI()` client construction (`cover-letter-generator/dist/llm.js`) at module scope, and with the handler itself going back to a static import, avoiding it in the adapter file no longer accomplishes anything. **This intentionally reverses the startup-crash workaround from the v3.0.7/#103 entry below**: since `app.ts` now imports both files transitively at process startup, a missing `OPENAI_API_KEY` once again crashes the server immediately on boot instead of surfacing as a runtime 500 on the first `POST /cover-letters/upload/text` request. This is now the desired behavior rather than the bug it was treated as in #103 — it matches what CLAUDE.md's/README.md's `OPENAI_API_KEY` env-var table already documented ("required at process startup, not just call time"), a claim that was actually false from #103 until this fix. Fail-fast at startup is preferable to a deferred failure on first real request. No change to `POST /cover-letters/upload/text`'s request/response shape or happy-path behavior (closes #111).

## v3.0.7

### Changed

- `POST /cover-letters/upload/text` (`uploadCoverLetterAsText.ts`) now embeds cover letter segments with `embedCoverLetterSegments` from the `cover-letter-generator` package (installed in #102) instead of the locally-implemented `createStoredCoverLetterFromTextSegments`, which is deleted along with its file (`src/coverLetters/coverLetterEmbeddings.ts`) and test — the package now owns this segmentation/embedding logic per #96's migration plan. Since the package's `CoverLetter` segments carry an optional `embedding` (`embedding?: TextEmbedding`) while jobMatchServer's `StoredCoverLetter`/`CoverLetterSegment` shape expects it nullable, new `toStoredCoverLetter`/`toStoredCoverLetterSegment` adapters in `uploadCoverLetterAsText.ts` translate between the two (`embedding: segment.embedding ?? null`). `COVER_LETTER_SEGMENT_NAMES` (formerly in the now-deleted `coverLetterSegmentation.ts`) and `embedMany` (`embeddings.ts`) are de-exported (now file-local) since their only external consumer was the deleted file. Drop-in replacement — stored `coverLetters` documents are equivalent to before for the same input, no observable behavior change (closes #104).
- `uploadCoverLetterAsText.ts` now imports both `segmentCoverLetter` and `embedCoverLetterSegments` from `cover-letter-generator` dynamically (a single `await import('cover-letter-generator')` inside the request handler) instead of statically at module scope. #103 found that the package eagerly constructs an `OpenAI` client at its own module scope (`node_modules/cover-letter-generator/dist/llm.js`) and worked around the resulting test-suite crashes with a placeholder `OPENAI_API_KEY` in `jest.setup.mjs`, but that only masked the symptom in tests — a static top-level import of either function in this file, or of the package's `COVER_LETTER_SEGMENT_NAMES` value export in `coverLetterAdapters.ts` (also #103, reachable from `app.ts` via `generateCoverLettersAsText.ts`), still made the whole server crash at startup in production whenever `OPENAI_API_KEY` is unset, instead of only failing the one endpoint that needed it per-request as before. `coverLetterAdapters.ts` now hardcodes its own copy of the 6 segment names instead of importing the package's `COVER_LETTER_SEGMENT_NAMES` at module scope, since that's the only place outside `uploadCoverLetterAsText.ts` that referenced it as a value (not just a type). Verified by importing the built `dist/app.js` with `OPENAI_API_KEY` unset before and after each fix. The shared `src/testMockModules/coverLetterGenerator.test.ts` mock factory (added by #103) now also exports an `embedCoverLetterSegments` mock alongside `segmentCoverLetter`, since both are mocked from the same module.

## v3.0.6

### Changed

- Replaced the local cover-letter segmentation implementation (`src/coverLetters/coverLetterPreprocessing.ts`, `coverLetterSegmentation.ts`, `coverLetterSegmentationFallback.ts`, and their tests, all deleted) with `segmentCoverLetter`/`COVER_LETTER_SEGMENT_NAMES`/`CoverLetterSegments` imported directly from the `cover-letter-generator` package (installed as a dependency by #102). The two small jobMatchServer-specific functions the package doesn't provide — `getCoverLetterTextSegments`/`reconstructCoverLetterText`, which convert to/from this repo's Mongo `StoredCoverLetter` shape — now live in a new `src/coverLetters/coverLetterAdapters.ts` (with its own tests), and `coverLetterEmbeddings.ts`, `generateCoverLettersAsText.ts`, and `uploadCoverLetterAsText.ts` were repointed at the package accordingly. The now-redundant local `CoverLetterTextSegments` type was removed from `src/types.ts` in favor of the package's structurally identical `CoverLetterSegments`. A new shared `src/testMockModules/coverLetterGenerator.test.ts` mock factory (mirroring the existing `mongodb.test.ts` one) replaces the deleted per-file segmentation mocks. Segmentation output, confidence scoring, and heuristic-vs-LLM-fallback behavior are all unchanged — this is a drop-in swap of an already-extracted implementation, not a behavior change (closes #103).
- Fixed a regression surfaced by the swap above: `cover-letter-generator`'s `dist/llm.js` constructs `new OpenAI()` at module import time (unlike the deleted local code, which only built the client lazily inside the LLM-fallback function), so merely importing the package — even just for `COVER_LETTER_SEGMENT_NAMES` or types — started throwing `Missing credentials...` without `OPENAI_API_KEY` set, crashing 3 test suites that previously never needed a real key since they mock segmentation/embeddings and never call the real OpenAI API. Added `jest.setup.mjs` (wired via a new `setupFiles` entry in `jest.config.mjs`) that sets a placeholder `process.env.OPENAI_API_KEY ??= 'test-key'`, matching the convention `cover-letter-generator`'s own test script already uses. Also dropped the now-stale `cover-letter-generator` entry from `.fallowrc.json`'s `ignoreDependencies` (added by #102 when the package was install-only; it's genuinely used from `src/` now, so the suppression no longer applies) and added an ESLint config block granting `.mjs`/`.cjs` files the `process` global, needed for the new setup file to pass lint.

## v3.0.5

### Added

- Added `cover-letter-generator` (`github:freshmozart1/cover-letter-generator#v0.9.1`) as an installed dependency, in preparation for replacing the logic in `src/coverLetters/` (tracked separately in #96) — no `src/` code imports it yet, so this is install-only with no behavior change. `.npmrc` now sets `allow-git=all` instead of the default, since `cover-letter-generator` itself pulls in `cosine-similarity` via a git tag, a transitive (non-root) git dependency that `allow-git=root` doesn't cover. `.fallowrc.json`'s `ignoreDependencies` was updated so the `fallow` static analyzer doesn't flag the new package as unused, which is expected until #96 wires it in (closes #102).

## v3.0.4

### Fixed

- `POST /scrape/linkedin` (`scrapeJob.ts`) now aborts the in-progress `runScrape` call(s) when the client disconnects mid-stream (e.g. the MatchPage is reloaded while a scrape is running), instead of letting them run to completion orphaned in the background. An `AbortController` is created per request and aborted from a `req.on('close', ...)` listener; its signal is passed into every `runScrape` call, which already supported cooperative cancellation via `RunScrapeOptions.signal` and rejects with `ScrapeAbortedError` when aborted. Writes to the response (streamed job data, error chunks, the final `res.end()`) are also skipped once the client has disconnected, since the socket is already gone by then (closes #100).

## v3.0.3

### Changed

- Split `src/index.ts` (459 lines mixing Express app/route wiring, CORS origin-checking, Python binary resolution, the token-service subprocess manager, and process shutdown/signal handling) into `src/app.ts` (Express instance, CORS/JSON middleware, route registrations), `src/server/listen.ts` (`listenWithFallback`, the port-binding/`EADDRINUSE`-retry logic), `src/server/shutdown.ts` (`registerShutdownHandlers`, graceful shutdown/signal handling), and `src/tokenService/resolvePythonBinary.ts` / `src/tokenService/startTokenService.ts` (Python binary resolution and the token-service subprocess manager), leaving `src/index.ts` a thin entrypoint. Purely structural — no runtime behavior change (closes #92).

## v3.0.2

### Removed

- Deleted `src/utils/getScrapeJobRequestParamsFromBody.ts` and `src/utils/getLinkedInJobLinkSearchParamsFromBody.ts` (and their tests), and removed the `ScrapeJobRequestParams`/`LinkedInJobLinkSearchParams` type exports from `src/types.ts` — dead code that was never wired to any route; no behavior change (closes #95).

## v3.0.1

### Fixed

- `scrapeJob.ts` now calls `computeJobMatch` (`linkedInJobSimilarity.ts`) when building each streamed job, restoring the `match` similarity score against previously liked/disliked jobs that was dropped when the scraper was rewritten around `linkedin-job-scraper` (#85/#86) — every job streamed from `POST /scrape/linkedin` had `match: undefined` since then. `title`/`company`/`descriptionText` are also run back through `linkedInTextUtils.ts`'s `extractJobTitle`/`coalesceText`/`normalizeDescription` helpers, matching the old Playwright-based scraper's normalization (closes #93).

## v3.0.0

### Breaking

- `POST /scrape/linkedin/playwright` is renamed to `POST /scrape/linkedin` — it hasn't scraped via a local Playwright implementation since the `linkedin-job-scraper` package migration, so the old path was misleading. Update any client hardcoding it (closes #87).

### Removed

- Deleted `src/scrapers/linkedin/playwright/` (`scrapeJobs.ts`, `extractLinkedInJobSearchResults.ts`, `waitForLinkedInPage.ts`, `extractCompanyAddress.ts`, and their tests) — dead code left over from the switch to the `linkedin-job-scraper` package; nothing outside the folder imported from it.
- Removed `extractLinkedInJobId` (`linkedInJobPageUrl.ts`) and the `ScrapeJobResponseBody`/`ExtractedLinkedInJobPage` types, orphaned once the playwright folder was gone — `linkedin-job-scraper` provides `sourceJobId` directly, and the SSE-streaming response replaced the old batched-JSON shape these types described.
- Dropped the `npx playwright install` setup step and the `PLAYWRIGHT_HEADLESS` env var doc entry from CLAUDE.md/README.md — nothing production-reachable needs real browser binaries anymore.

### Fixed

- README.md's Technology Stack section still listed Playwright for LinkedIn scraping, contradicting its own Architecture section.
- The Postman collection request for this route still pointed at the old `/scrape/linkedin/playwright` URL.

## v2.0.1

### Fixed

- `scrapeJob.ts` computes a real `duplicateKey` (`linkedin:${sourceJobId}`, with a normalized-URL fallback) instead of hardcoding it to `''`, and skips streaming a job over SSE when its `duplicateKey` is already stored in MongoDB — restoring the old Playwright-based scraper's dedupe behavior that was lost when the scraper was rewritten around `linkedin-job-scraper` (closes #86).
- The `MongoClient` opened for `POST /scrape/linkedin/playwright` is now closed even when the initial `connect()` call fails, instead of leaking the connection.

### Changed

- Extracted `scrapeJob.ts`'s per-job dedupe/embed/stream logic into smaller top-level functions (`computeDuplicateKey`, `buildRawJob`, `forwardJobIfNew`, `handleProgressEvent`) — no behavior change, resolves a CRAP-threshold complexity finding flagged by `fallow audit`.

## v2.0.0

### Breaking

- `ScrapedJob.companyAddress: CompanyAddress` (singular) is now `companyAddresses: CompanyAddress[]` (plural), forwarding the real office addresses `linkedin-job-scraper` looks up per company instead of a hardcoded empty placeholder. Primary address (if any) is at index 0. Consumers of `POST /scrape/linkedin/playwright` and `POST /jobs/create` need to update accordingly.

### Fixed

- `scrapeJob.ts`'s `onProgress` handler only forwarded/persisted a scraped job when `linkedin-job-scraper` reports `job:done` with `status: 'success'`; a failed result is now logged instead of being streamed to the frontend as if it were a real listing.
- `job:stale` events (suspect results flagged by `companyMismatch`, `sourceJobIdMismatch`, or `lateOverlayDetected`) are now logged instead of silently dropped.
- CI can now install the private `linkedin-job-scraper` git dependency: `actions/checkout`'s repo-scoped `github.com` auth header (carrying a token with no access to that repo) is cleared before authenticating with a dependency-specific PAT.

### Changed

- `linkedin-job-scraper` bumped from `v0.4.3` to `v0.7.1`.
- Extracted `scrapeJob.ts`'s inline request-body validation into `src/utils/getLinkedInJobScraperSearchParamsFromBody.ts`, reusing `getTrimmedUniqueKeywords` and matching this codebase's existing `get*FromBody` validator convention — removes a duplicated block and a CRITICAL-complexity function flagged by `fallow audit`.
