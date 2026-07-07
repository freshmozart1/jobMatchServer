# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Node.js/Express backend that scrapes LinkedIn job postings, computes semantic embeddings (OpenAI `text-embedding-3-small`), ranks jobs by similarity to liked/disliked examples, and generates tailored cover letters via `gpt-5.5`. See README.md for the full HTTP endpoint reference and request/response shapes; this file focuses on architecture that spans multiple files.

## Architecture

- **Everything routes through `src/index.ts`.** There are no router modules — every endpoint is wired directly on `app` in that file, alongside CORS handling, graceful shutdown, and the token-service subprocess lifecycle. Handler logic itself lives in `src/database/*.ts`, `src/scrapers/**`, `src/coverLetters/*.ts`, and `src/tokens/*.ts`.
- **Single MongoDB database (`jobMatch`), five collections**: `jobs`, `coverLetters`, `cv`, `certificates`, `users`. There is no auth/multi-tenancy — `getApplication.ts` reads a single hardcoded `USER_ID`. Each handler opens its own short-lived `MongoClient` (connect → operate → close in a `finally`); there's no shared/pooled client.
- **Job scoring pipeline** (`src/scrapers/linkedin/playwright/scrapeJobs.ts` → `src/embeddings/jobEmbedding.ts` → `src/scrapers/linkedin/linkedInJobSimilarity.ts`): a scraped job is normalized, embedded, then scored against the average embedding of previously liked jobs (`like: true` docs) minus disliked ones, with liked/disliked embedding sets cached in-memory for 30s (`CACHE_TTL_MS` in `linkedInJobSimilarity.ts`) to avoid refetching on every job in a batch. `duplicateKey` (LinkedIn job ID when available, else the normalized URL) is the dedupe key used both to filter already-stored jobs and to upsert on `POST /jobs/create`.
- **Cover letter pipeline** (`src/coverLetters/`): letters are stored *segmented* (`subject`/`salutation`/`introduction`/`mainBody`/`conclusion`/`greetings`, see `CoverLetterSegmentName` in `src/types.ts`), each with its own embedding. Segmentation is heuristic first with an LLM fallback (`coverLetterSegmentation.ts` / `coverLetterSegmentationFallback.ts`). Matching a job to past letters uses a fixed per-segment weighting (`SEGMENT_SIMILARITY_WEIGHTS` in `getTopXSimilarCoverLetters.ts`, `mainBody` dominant at 0.5) rather than a single whole-letter embedding.
- **Token counting is a Python sidecar**, not a Node library: `src/tokenService/tokenService.py` (Flask + `tiktoken`) is spawned lazily on first request by `ensureTokenServiceStarted()` in `index.ts`, which picks its own free port, prints `TOKEN_SERVICE_URL=http://...` on stdout, and is parsed line-by-line to learn the URL (stashed in `process.env['TOKEN_SERVICE_URL']`, consumed by `src/tokens/fetchTokens.ts`). The service is excluded from `tsc`/ESLint/nodemon watching (`src/tokenService/**`) since it isn't TypeScript. Python binary resolution order: `PYTHON` env var → `.venv/bin/python` → interpreter behind `pip`/`pip3` on `PATH` → `python3`.
- **Application PDF assembly** (`getApplication.ts`): the stored cover letter is rendered from `src/database/coverLetter.html` (a `{{placeholder}}` template, copied to `dist/` by the build step) to PDF via headless Puppeteer, then merged with the stored CV and any certificates (PDF/JPEG/PNG) into one PDF via `pdf-lib`. A malformed certificate is skipped, not fatal, to the merge.
- **Uploaded-file path safety**: `src/utils/isPathInside.ts` gates every filesystem read derived from a DB-stored `filePath` (CV, certificates) before `path.resolve()`/`readFile` — required because `getApplication.ts` and `getCV.ts` trust paths coming out of MongoDB, not directly off the request.
- **`// fallow-ignore-file security-sink` header comments** appear on a few files (`index.ts`, `getApplication.ts`, `isPathInside.ts`, `fetchTokens.ts`). These are dated, reasoned suppressions of the `fallow` static analyzer's security-sink rule (e.g. "this `fetch()` target is a locally-spawned sidecar URL, never attacker input"), not dead comments — don't strip them without re-verifying the claim still holds, and add an equivalent comment if you introduce a new sink that needs the same treatment.
- **Test mocking**: `src/testMockModules/*.test.ts` hold reusable `jest.unstable_mockModule()` factories (e.g. `mongodb.test.ts` mocks `MongoClient`/`ObjectId`) imported by multiple `*.test.ts` files, so a MongoDB/embeddings/segmentation mock is defined once and shared rather than duplicated per test file.

## Build & test

```bash
npm run build        # tsc + copies src/database/coverLetter.html → dist/
npm run dev          # nodemon with ts-node ESM loader
npm run test:once    # build then run Jest once — use this, not `npm run test` which loops forever
npm run lint         # eslint .
npm run format       # prettier --write .
npm run mongo        # starts a local mongod using the homebrew dbpath
```

To run a single test file:

```bash
node --experimental-vm-modules --localstorage-file=/tmp/jest-localstorage.json ./node_modules/jest/bin/jest.js --config jest.config.mjs --runInBand dist/path/to/file.test.js
```

## Testing

- **Always build before running Jest** — tests run against compiled output in `dist/`, not source TypeScript.
- ESM mocking uses `jest.unstable_mockModule()` — mock setup must precede the module-under-test import, which must use dynamic `await import(...)`.
- `testHelpers/` and `testMockModules/` hold shared utilities named `*.test.ts`; they are excluded from test suites via `testPathIgnorePatterns`, not `testMatch`.
- `--runInBand` is required (already set in config) — tests run serially to avoid Puppeteer/MongoDB conflicts.

## TypeScript conventions

- `"moduleResolution": "nodenext"` — **all local imports must end in `.js`**, even in `.ts` source (e.g., `import foo from './foo.js'`).
- `verbatimModuleSyntax: true` — use `import type` for type-only imports.
- `noUncheckedIndexedAccess: true` — array/object index access returns `T | undefined`.
- `exactOptionalPropertyTypes: true` — optional properties cannot be explicitly assigned `undefined` unless `undefined` is in their type.
- Path aliases (`#scrapers/*`, `#database/*`, `#types`, `#index`, `#utils/*`) are defined in **both** `package.json` `imports` and `tsconfig.json` `paths` — update both when adding a new alias.
- The playwright-based LinkedIn scraper (`src/scrapers/linkedin/playwright/`) needs browser binaries installed locally: run `npx playwright install` once after `npm install`. This is a machine-local setup step (binaries aren't committed) — CI would need an equivalent step (e.g. `npx playwright install --with-deps`) before any test that launches a real browser. Jest's unit tests mock playwright entirely, so this isn't required just to run `npm run test:once`.

## Required environment variables

| Variable                    | Notes                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | MongoDB connection URI; checked at startup and before every DB call         |
| `OPENAI_API_KEY`            | Picked up automatically by the OpenAI SDK — no explicit reference in source |
| `PYTHON`                    | Optional; overrides Python binary resolution for the token-service subprocess |

No `.env` file or dotenv library is used. Set variables in the shell or a process manager.

## Git / GitHub flow

Follow [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow) for all changes:

1. **Create a branch** off `master` — short, descriptive name with a prefix: `feat/...`, `fix/...`, `refactor/...`, `docs/...`. Folding the issue number in is common in this repo, e.g. `docs/issue-66-update-readme`.
2. **Make changes** — keep each commit isolated and complete (e.g. don't mix an unrelated rename into a commit adding tests) so it can be reverted independently. Use a conventional commit message: `type: short description`, adding `(closes #N)` when the commit closes an issue.
3. **Open a pull request** against `master` — summarize what changed and why. Open it as a **draft** if you want early feedback before it's ready for review.
4. **Address review comments** — push additional commits to the same branch; the pull request updates automatically.
5. **Wait for CI, then merge** — `.github/workflows/test.yml` runs `npm run test:once` (against a real MongoDB service container) on every push and pull request; don't merge until it's green. This repo's history is entirely merge commits (`Merge pull request #N from ...`), not squashes — match that unless told otherwise.
6. **Delete the branch** after it's merged.
