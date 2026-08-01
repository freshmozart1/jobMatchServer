# Changelog

All notable changes to this project are documented in this file.

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
