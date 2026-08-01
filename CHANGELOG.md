# Changelog

All notable changes to this project are documented in this file.

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
