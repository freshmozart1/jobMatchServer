# LinkedIn Job Scraper

A Node.js/Express backend that scrapes LinkedIn job postings, ranks them against jobs you've previously liked or disliked using OpenAI embeddings, and generates tailored cover letters and complete application PDFs (cover letter + CV + certificates).

The goal of this project is to provide the data collection, ranking, and application-generation service for a job management workflow, so another app (e.g. a UI) can trigger scrapes, review ranked jobs, and produce ready-to-send applications.

## Project Status

This project is under active development. Implemented today:

- Express server entry point (`src/index.ts`) with automatic port fallback starting from port `3000`
- MongoDB persistence for jobs, cover letters, CVs, certificates, and a user profile
- LinkedIn scraper (via the `linkedin-job-scraper` package) that gathers job search results and extracts job + company details
- OpenAI (`text-embedding-3-small`) embeddings for jobs and cover letters, used to rank scraped jobs by similarity to liked/disliked examples
- Cover letter ranking and generation via the [`cover-letter-generator`](https://github.com/freshmozart1/cover-letter-generator) package, seeded with your most similar past cover letters
- CV and certificate upload endpoints (PDF/JPEG/PNG), with per-job status checks
- Merged application PDF generation (cover letter rendered to PDF via Puppeteer, combined with the CV and certificates via `pdf-lib`)
- A companion Python token-counting microservice (Flask + `tiktoken`), spawned automatically at server startup
- Automated tests (Jest) covering scrapers, utilities, embeddings, and database logic

Not yet implemented:

- Scheduled/recurring scraping jobs
- Authenticated LinkedIn session support
- Multi-user support (the application/user record is currently a single hardcoded user)

## Architecture

1. **Express server** (`src/app.ts`) exposes all HTTP endpoints and handles CORS for a local frontend; `src/server/listen.ts` and `src/server/shutdown.ts` handle port-binding fallback and graceful shutdown of the Playwright browser and token service; `src/index.ts` is the thin entrypoint that wires them together.
2. **LinkedIn scraping layer** (`src/scrapers/linkedin/scrapeJob.ts`) invokes the `linkedin-job-scraper` package to gather job search results and extracts job postings and company addresses.
3. **Embeddings layer** (`src/embeddings/`) computes OpenAI embeddings for jobs and compares a new job's embedding against the average embedding of previously liked/disliked jobs to produce a match score.
4. **MongoDB storage layer** (`src/database/`) persists jobs (deduplicated by `duplicateKey`), cover letters (with per-segment embeddings), CVs, certificates, and users.
5. **Cover letter pipeline**: `src/database/uploadCoverLetterAsText.ts` stores uploaded cover letters segmented and embedded, and `src/coverLetters/` ranks stored letters against a target job and generates a new one from the top matches. Segmentation, embedding, ranking, and generation are all delegated to the `cover-letter-generator` package — jobMatchServer keeps MongoDB access, the Express layer, and the adapters between its `StoredCoverLetter` shape and the package's types.
6. **Token service** (`src/tokenService/tokenService.py`) is a small Flask + `tiktoken` process spawned as a subprocess at startup, used to count prompt tokens since Node has no exact equivalent of OpenAI's tokenizer.
7. **Application assembly** (`src/database/getApplication.ts`) renders the generated cover letter to a PDF with Puppeteer and merges it with the stored CV and any certificates into a single downloadable PDF.
8. **Consumer applications** call these endpoints (or read MongoDB directly) to drive a job search/apply workflow.

## Technology Stack

- Node.js, TypeScript (`nodenext` module resolution, strict mode)
- Express 5
- MongoDB (official `mongodb` driver)
- `linkedin-job-scraper` (LinkedIn scraping)
- Puppeteer (cover letter HTML → PDF rendering)
- `pdf-lib` (merging cover letter, CV, and certificate PDFs)
- OpenAI SDK (`text-embedding-3-small` embeddings for job-liking ranking)
- `cover-letter-generator` (cover letter ranking and generation)
- Python 3 + Flask + `tiktoken` (token-counting microservice)
- Multer (file uploads)
- Jest (tests), ESLint and Prettier
- Nodemon for local development

## Getting Started

Requires Node.js >= 22.9.0 (see `engines` in `package.json`).

Install Node dependencies:

```bash
npm install
```

Set up the Python token service (one-time):

```bash
python3 -m venv .venv
.venv/bin/pip install -r src/tokenService/requirements.txt
```

The server resolves a Python binary at startup in this order: the `PYTHON` env var, `.venv/bin/python`, the interpreter behind `pip`/`pip3` on `PATH`, then `python3`. If you use a different virtualenv layout, set `PYTHON` to the full path of your interpreter.

Start the development server — this also starts a local MongoDB (`npm run mongo` under the hood) unless you point `MONGODB_CONNECTION_STRING` at an existing instance:

```bash
npm run dev
```

Build the TypeScript project:

```bash
npm run build
```

Start the built server:

```bash
npm start
```

Run the test suite (builds first, then runs Jest against `dist/`):

```bash
npm run test:once
```

Check that the OpenAI API still accepts the model and reasoning effort `cover-letter-generator` generates cover letters with (builds first, then sends one live Responses API request):

```bash
npm run smoke:generator-model
```

The test suite mocks `cover-letter-generator` entirely, so it can't catch a model or reasoning effort the API no longer accepts. This check reads both from the installed package and sends one small request using `OPENAI_API_KEY` (loaded from `.env` if present), so **a local run bills a real API request**. It prints `Passed`, `Skipped`, or `Failed` and exits non-zero only on failure; with no key set it skips without calling the API.

## Runtime Behavior

On startup the server spawns the Python token service, then starts listening on port `3000`. If the port is already in use, it automatically tries the next port until it finds one available. Startup does not print the MongoDB connection URI, which may contain credentials or secret query parameters.

Example startup output:

```text
Token service running on http://localhost:5001
Server running on http://localhost:3000
```

## Required Environment Variables

| Variable                    | Notes                                                                                                                                                                                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_CONNECTION_STRING` | MongoDB connection URI; checked at startup and before every DB call                                                                                                                                                                                                                                             |
| `OPENAI_API_KEY`            | Picked up automatically by the OpenAI SDK; the server never reads it explicitly, but `npm run smoke:generator-model` does. Also now required at process startup, not just call time — `cover-letter-generator`'s `dist/llm.js` constructs an OpenAI client at import time, and `src/app.ts` imports it eagerly. |
| `PYTHON`                    | Optional. Overrides Python binary resolution for the token service subprocess                                                                                                                                                                                                                                   |
| `CORS_ALLOWED_ORIGINS` | Optional comma-separated additional exact HTTP(S) frontend origins; see Browser Origins (CORS) below. |

Copy `.env.example` to `.env` and fill in the values to configure these locally — `npm run dev` and `npm start` both load it automatically via Node's `--env-file-if-exists` flag if present. Variables already set in the shell or by a process manager take precedence over `.env` values.

## Browser Origins (CORS)

The API allows these local frontend origins by default:

| Workflow | Origins |
| --- | --- |
| Development | `http://localhost:5173`, `http://127.0.0.1:5173` |
| Preview | `http://localhost:4173`, `http://127.0.0.1:4173` |

Existing HTTP development access from valid `192.168.*.*` addresses on port
`5173` remains supported. For deployment domains, other LAN subnets, or LAN
preview ports, set `CORS_ALLOWED_ORIGINS` to a comma-separated list of
additional exact origins, for example:

```dotenv
CORS_ALLOWED_ORIGINS=https://jobs.example.com,http://10.0.0.10:5173,http://192.168.1.10:4173
```

These values extend the defaults. Use the browser's exact `location.origin`
format: HTTP(S) scheme and host, with a non-default port if needed. Do not
include a trailing slash, path, username/password, query, fragment, wildcard,
`null`, or a redundant default port (`:80` for HTTP or `:443` for HTTPS).
Whitespace around list entries is ignored; unset or blank configuration adds
no origins. Empty entries in a nonempty list, invalid URLs, and noncanonical
origins stop app initialization with an indexed configuration error that does
not echo the invalid value. Restart the backend after changing configuration.

An unconfigured origin receives no `Access-Control-Allow-Origin` header, so
browsers deny cross-origin access. Requests without an `Origin` header still
work normally. Responses vary by `Origin`, including denied/no-Origin
responses; preflight replies retain `204`, `GET,POST,OPTIONS`, and the
`Content-Type` allowed header.

## API Endpoints

### `GET /health`

Lightweight process health check. Returns `{ "status": "ok" }`.

### `POST /scrape/linkedin`

Scrapes LinkedIn job search results.

Body:

```json
{
    "keywords": ["software engineer", "typescript"],
    "location": "Berlin",
    "distance": 25,
    "datePosted": "week"
}
```

`keywords` may be a string or an array of strings (one concurrent scrape per
keyword). `datePosted` is one of `"day"`, `"week"`, or `"month"`. `location` is
optional — omit it, or send `""`, to search without narrowing to a city, and the
param is simply not sent to LinkedIn; any other non-string value is rejected.
`distance` is optional too — omit it, or send a positive integer, but it is
only forwarded to LinkedIn (as `distanceMiles`) when `location` is also
present; a `distance` sent without a `location` is accepted but never reaches
LinkedIn, since a radius is meaningless without a location to centre it on,
and any other value is rejected. The response
is an SSE stream. It starts with a `: ping` comment, sends a `: keepalive`
comment every 15 seconds, and carries these JSON values in `data:` frames:

```ts
type ScrapeStreamFrame =
    | { type: 'job'; job: ScrapedJob }
    | {
          type: 'progress';
          keyword: string;
          stage: 'loading';
          discovered: number;
      }
    | {
          type: 'progress';
          keyword: string;
          stage: 'scanning';
          current: number;
          total: number;
          failed: number;
          dropped: number;
      }
    | {
          type: 'error';
          error: string;
          reason: string;
          keyword?: string;
      };
```

`current` is one-based, or `0` after discovery and before the first job starts.
Failed and dropped counts describe distinct job indices by their latest result,
so a successful retry removes an earlier failure from the count. For each
keyword, the route skips already-stored cards before clicking when possible,
extracts and embeds new jobs, computes their like/dislike match score, and
filters any remaining duplicates before emitting a job frame.

A database lookup, embedding, or scoring failure for an individual job emits
an error frame with `error: "Job processing failed"`, its keyword, and a
sanitized reason identifying the one-based job index and suggesting a retry.
The keyword's `failed` count includes that job; other jobs keep processing.
Provider/database details remain in server logs. The stream and database
client stay open until all pending job processing has settled, and a
client disconnect suppresses further frames while cleanup completes.

### `POST /jobs/create`

Body: `{ "job": ScrapedJob, "like": boolean }`. Upserts the job into MongoDB keyed by the exact `duplicateKey`, recording whether it was liked or disliked (used to rank future scrapes). Repeated saves replace only that job, preserving its database ID. Returns `201` with `{ "message": "Job created", "jobId": "..." }`.

The body and job must be plain objects containing only the documented fields
(see [Job Model](#job-model)); `like` belongs on the body, not inside `job`.
Database-owned fields such as `_id` are not accepted. Validation runs before
any database setup or access; malformed requests return `400` with `message`
and `error` strings and do not write a job.

- `duplicateKey` must be a string containing at least one non-whitespace
  character. Objects, arrays, and MongoDB operators are rejected.
- `sourceHostname`, `sourceUrl`, `title`, `company`, and `scrapedAt` must be
  present as strings. Empty strings from scraper normalization remain valid.
- `embedding` must be a non-empty array of finite numbers. No fixed vector
  dimension is imposed by this endpoint.
- `companyAddresses` must be an array (which may be empty). Each address must
  contain exactly the four string fields shown in the model; empty strings
  are valid when the scraper could not determine part of an address.
- Optional `sourceJobId`, `location`, `descriptionText`, and `postedAt` must
  be strings when present; optional `tags` must be an array of strings and
  optional `match` must be a finite number. Omitted optional fields are valid.

### `POST /cover-letters/upload/text`

Body: `{ "coverLetterText": string, "jobDuplicateKey"?: string }`. Segments the text into salutation/introduction/main body/conclusion/greetings (heuristic, with an LLM fallback), embeds each segment, and stores it — upserted against the given job if `jobDuplicateKey` is provided.

### `GET /cover-letters/:jobDuplicateKey`

Renders the stored cover letter to a standalone PDF and streams it as `cover-letter.pdf`.

The existing one-page layout is checked in the browser using print styles,
loaded fonts, and the actual body text bounds. Text that would be clipped
vertically or horizontally returns `422` JSON instead of a partial PDF:

```json
{
    "message": "Cover letter text does not fit on one page. Shorten the letter and try downloading again.",
    "error": "Cover letter text does not fit on one page. Shorten the letter and try downloading again."
}
```

Shorten the saved cover letter and retry the download. This check measures
layout rather than applying a character limit; empty trailing paragraph
margins do not count as clipped text. The combined application download uses
the same check and error. Other rendering failures still return `500`.

### `POST /cv/upload`

Multipart form upload (`file`) plus a `jobDuplicateKey` field. Stores the CV file and associates it with the job. The upload must genuinely be a PDF: its declared `Content-Type` must be `application/pdf`, and its actual content is verified against the PDF file signature (magic bytes). A file that fails either check is rejected with `400` and deleted from disk.

### `GET /cv/:jobDuplicateKey`

Streams the stored CV PDF for the given job.

### `GET /cv/:jobDuplicateKey/status`

Returns whether a CV has been uploaded for the given job.

### `POST /certificates/upload`

Multipart form upload (up to 10 files, 10MB each, PDF/JPEG/PNG only) plus a `jobDuplicateKey` field. Stores each certificate and associates it with the job. Each file's declared `Content-Type` and its actual content (verified against the PDF/JPEG/PNG file signature) must both match a PDF, JPEG, or PNG. This check is all-or-nothing across the batch: if any file fails, every file in the request is rejected with `400` and deleted from disk.

### `GET /certificates/:jobDuplicateKey/status`

Returns whether certificates have been uploaded for the given job.

### `POST /cover-letters/create/text`

Body: a job plus `{ "x"?: number }` (default `3`). Ranks all stored cover letters against the job using the [`cover-letter-generator`](https://github.com/freshmozart1/cover-letter-generator) package's `embedJob` and `getTopXSimilarCoverLetters`, then generates a new cover letter from the top `x` matches via the package's `generateCoverLetter`. Generation itself is delegated to that package, so the exact model it uses internally isn't documented here. Returns `{ "coverLetter": string, "saved": true, "coverLetterId": string }`. `saved: true` means the generator's exact embedded segments are already persisted under the request job's `duplicateKey`; clients should not immediately upload the unchanged generated text through `POST /cover-letters/upload/text`. The entire handler operation, including the MongoDB read, provider work, and generated-letter persistence, has a 5-minute deadline. If it expires, the route returns `504` with `{ "message": "Cover letter generation deadline exceeded", "error": "Request deadline exceeded" }` instead of the existing sanitized `500` used for provider or database failures. The deadline bounds how long the handler waits; this repository cannot cancel package-owned provider work, and a provider or MongoDB operation may still settle (and a MongoDB client may close) after the `504` response.

`location`, `descriptionText`, `postedAt`, and `tags` are optional in the
generation request and may be omitted from JSON, individually or together.
If supplied, the first three must be strings and `tags` must be an array of
strings; `null` and other invalid types return `400`. A missing description is
passed to the generator as an empty string; missing location stays omitted.
Successful requests still persist the generated letter and return the same
`saved` and `coverLetterId` fields.

### `POST /cover-letters/revise/text`

Body: `{ "selectedText": string, "instruction": string, "coverLetterText": string, "job": { "title": string, "company": string, "location"?: string, "description"?: string } }`. Revises the selected passage using the instruction, complete draft, and job as context. Returns `{ "replacementText": string }`. The operation is stateless: the caller remains responsible for replacing the selected range and persisting the resulting draft through `POST /cover-letters/upload/text`. The entire provider-backed operation has a 60-second deadline. If it expires, the route returns `504` with `{ "message": "Cover letter revision deadline exceeded", "error": "Request deadline exceeded" }` instead of the existing sanitized `500` used for provider failures. The deadline bounds how long the handler waits; this repository cannot cancel the package-owned provider work, which may still settle after the `504` response.

### `POST /tokens/count`

Body: `{ "text": string, "model"?: string }`. Proxies to the Python token service and returns the token count for the given text.

### `GET /application/:jobDuplicateKey`

Renders the stored cover letter to PDF, merges it with the CV and any certificates for that job, and streams the combined `application.pdf`.

The cover-letter overflow check described above runs before reading attachment
files or merging PDFs. An overflowing letter returns the same actionable
`422` JSON and no application PDF; shorten the letter before downloading
again.

## Job Model

Stored jobs use a normalized format so downstream applications don't need to understand LinkedIn-specific markup:

```ts
type CompanyAddress = {
    streetAddress: string;
    city: string;
    postalCode: string;
    countryCode: string;
};

type ScrapedJob = {
    sourceHostname: string;
    sourceJobId?: string;
    sourceUrl: string;
    title: string;
    company: string;
    location?: string;
    descriptionText?: string;
    postedAt?: string;
    scrapedAt: string;
    tags?: string[];
    duplicateKey: string;
    companyAddresses: CompanyAddress[];
    embedding: number[];
    match?: number;
};
```

The `duplicateKey` is stable across scrape runs and used to detect jobs that have already been stored.

## Development Notes

- Source files live in `src`; compiled output is written to `dist`.
- The project uses ES modules through `"type": "module"`; local imports must end in `.js` even in `.ts` source.
- Nodemon watches TypeScript files in `src` and runs the entry point through the `ts-node` ESM loader.
- TypeScript strict mode is enabled (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Tests run against compiled `dist/` output, not source TypeScript — always `npm run build` before running Jest directly.
- CI has two workflows: `.github/workflows/test.yml` runs `npm run test:once` on every push and pull request, and `.github/workflows/generator-model-smoke.yml` runs `npm run smoke:generator-model` weekly, on manual dispatch, and on pull requests that change the `cover-letter-generator` pin, the `openai` SDK version, or the smoke check itself. Pull requests that can't see the `OPENAI_API_KEY` secret (from a fork or Dependabot) skip the smoke check, while a scheduled or manual run without the secret fails.

## Responsible Scraping

Scraping job search sites can be sensitive. Development should be conservative and respectful:

- Review and comply with the relevant site's terms and policies.
- Use safe polling intervals and avoid aggressive request patterns.
- Store only the data required by the application.
- Protect credentials, cookies, tokens, and session files.
- Add clear logging so scrape failures can be diagnosed without exposing secrets.
