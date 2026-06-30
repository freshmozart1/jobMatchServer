# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Node.js/Express backend that scrapes LinkedIn job postings, computes semantic embeddings (OpenAI `text-embedding-3-small`), ranks jobs by similarity to liked/disliked examples, and generates tailored cover letters via `gpt-5.5`.

## Build & test

```bash
npm run build        # tsc + copies src/database/coverLetter.html → dist/
npm run dev          # nodemon with ts-node ESM loader
npm run test:once    # build then run Jest once — use this, not `npm run test` which loops forever
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
- Path aliases (`#scrapers/*`, `#database/*`, `#types`, `#index`) are defined in **both** `package.json` `imports` and `tsconfig.json` `paths` — update both when adding a new alias.

## Required environment variables

| Variable | Notes |
|---|---|
| `MONGODB_CONNECTION_STRING` | MongoDB connection URI; checked at startup and before every DB call |
| `OPENAI_API_KEY` | Picked up automatically by the OpenAI SDK — no explicit reference in source |

No `.env` file or dotenv library is used. Set variables in the shell or a process manager.

## Git conventions

- Feature branches off `master`: `feat/...`, `fix/...`, `refactor/...`, `docs/...`
- Conventional commit messages; PRs merge into `master`
- Commit format: `type: short description (closes #N) (#PR)`
