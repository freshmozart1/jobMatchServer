# LinkedIn Job Scraper

A Node.js/Express backend that scrapes LinkedIn job postings, ranks them against jobs you've previously liked or disliked using OpenAI embeddings, and generates tailored cover letters and complete application PDFs (cover letter + CV + certificates).

The goal of this project is to provide the data collection, ranking, and application-generation service for a job management workflow, so another app (e.g. a UI) can trigger scrapes, review ranked jobs, and produce ready-to-send applications.

## Project Status

This project is under active development. Implemented today:

- Express server entry point (`src/index.ts`) with automatic port fallback starting from port `3000`
- MongoDB persistence for jobs, cover letters, CVs, certificates, and a user profile
- Playwright-based LinkedIn scraper that paginates job search results and extracts job + company details
- OpenAI (`text-embedding-3-small`) embeddings for jobs and cover letters, used to rank scraped jobs by similarity to liked/disliked examples
- OpenAI (`gpt-5.5`) cover letter generation, seeded with your most similar past cover letters
- CV and certificate upload endpoints (PDF/JPEG/PNG), with per-job status checks
- Merged application PDF generation (cover letter rendered to PDF via Puppeteer, combined with the CV and certificates via `pdf-lib`)
- A companion Python token-counting microservice (Flask + `tiktoken`), spawned automatically at server startup
- Automated tests (Jest) covering scrapers, utilities, embeddings, and database logic

Not yet implemented:

- Scheduled/recurring scraping jobs
- Authenticated LinkedIn session support
- Multi-user support (the application/user record is currently a single hardcoded user)

## Architecture

1. **Express server** (`src/index.ts`) exposes all HTTP endpoints, handles CORS for a local frontend, and manages graceful shutdown of the Playwright browser and token service.
2. **Playwright scraping layer** (`src/scrapers/linkedin/playwright/`) opens LinkedIn job search pages, paginates results, and extracts job postings and company addresses.
3. **Embeddings layer** (`src/embeddings/`) computes OpenAI embeddings for jobs and compares a new job's embedding against the average embedding of previously liked/disliked jobs to produce a match score.
4. **MongoDB storage layer** (`src/database/`) persists jobs (deduplicated by `duplicateKey`), cover letters (with per-segment embeddings), CVs, certificates, and users.
5. **Cover letter pipeline** (`src/coverLetters/`) segments uploaded cover letters (heuristic first, LLM fallback), embeds each segment, ranks past cover letters by similarity to a target job, and generates new cover letters with `gpt-5.5`.
6. **Token service** (`src/tokenService/tokenService.py`) is a small Flask + `tiktoken` process spawned as a subprocess at startup, used to count prompt tokens since Node has no exact equivalent of OpenAI's tokenizer.
7. **Application assembly** (`src/database/getApplication.ts`) renders the generated cover letter to a PDF with Puppeteer and merges it with the stored CV and any certificates into a single downloadable PDF.
8. **Consumer applications** call these endpoints (or read MongoDB directly) to drive a job search/apply workflow.

## Technology Stack

- Node.js, TypeScript (`nodenext` module resolution, strict mode)
- Express 5
- MongoDB (official `mongodb` driver)
- Playwright (LinkedIn scraping)
- Puppeteer (cover letter HTML → PDF rendering)
- `pdf-lib` (merging cover letter, CV, and certificate PDFs)
- OpenAI SDK (`text-embedding-3-small` embeddings, `gpt-5.5` generation)
- Python 3 + Flask + `tiktoken` (token-counting microservice)
- Multer (file uploads)
- Jest (tests), ESLint and Prettier
- Nodemon for local development

## Getting Started

Install Node dependencies:

```bash
npm install
```

Install the Playwright browser binaries (one-time, machine-local; not committed):

```bash
npx playwright install
```

Set up the Python token service (one-time):

```bash
python3 -m venv .venv
.venv/bin/pip install -r src/tokenService/requirements.txt
```

The server resolves a Python binary at startup in this order: the `PYTHON` env var, `.venv/bin/python`, the interpreter behind `pip`/`pip3` on `PATH`, then `python3`. If you use a different virtualenv layout, set `PYTHON` to the full path of your interpreter.

Start MongoDB locally (or point `MONGODB_CONNECTION_STRING` at an existing instance):

```bash
npm run mongo
```

Start the development server:

```bash
npm run dev
```

Build the TypeScript project:

```bash
npm run build
```

Run the test suite (builds first, then runs Jest against `dist/`):

```bash
npm run test:once
```

## Runtime Behavior

On startup the server spawns the Python token service, then starts listening on port `3000`. If the port is already in use, it automatically tries the next port until it finds one available.

Example startup output:

```text
Token service running on http://localhost:5001
Server running on http://localhost:3000
```

## Required Environment Variables

| Variable                    | Notes                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `MONGODB_CONNECTION_STRING` | MongoDB connection URI; checked at startup and before every DB call            |
| `OPENAI_API_KEY`            | Picked up automatically by the OpenAI SDK — no explicit reference in source    |
| `PYTHON`                    | Optional. Overrides Python binary resolution for the token service subprocess  |

No `.env` file or dotenv library is used. Set variables in the shell or a process manager.

## API Endpoints

### `GET /health`

Lightweight process health check. Returns `{ "status": "ok" }`.

### `POST /scrape/linkedin/playwright`

Scrapes LinkedIn job search results with Playwright.

Body:

```json
{
  "keywords": "software engineer",
  "location": "Berlin",
  "distance": 25,
  "datePosted": "604800",
  "maxPages": 3
}
```

`keywords` may be a string or an array of strings (one scrape per keyword). `datePosted` is one of `"86400"` (24h), `"604800"` (week), or `"2592000"` (month). For each keyword, paginates search results, extracts job and company details, embeds new jobs, computes a like/dislike match score, filters out jobs already stored, and returns them grouped by keyword along with the search URL used.

### `POST /jobs/create`

Body: `{ "job": ScrapedJob, "like": boolean }`. Upserts the job into MongoDB keyed by `duplicateKey`, recording whether it was liked or disliked (used to rank future scrapes). Returns `{ "message": "Job created", "jobId": "..." }`.

### `POST /jobs/top-x-similar-cover-letters`

Body: a job (with its `embedding`) plus `{ "x": number }`. Ranks stored cover letters by weighted cosine similarity of their segment embeddings against the job embedding and returns the top `x` cover letter IDs.

### `POST /cover-letters/upload/text`

Body: `{ "coverLetterText": string, "jobDuplicateKey"?: string }`. Segments the text into salutation/introduction/main body/conclusion/greetings (heuristic, with an LLM fallback), embeds each segment, and stores it — upserted against the given job if `jobDuplicateKey` is provided.

### `POST /cv/upload`

Multipart form upload (`file`) plus a `jobDuplicateKey` field. Stores the CV file and associates it with the job.

### `GET /cv/:jobDuplicateKey`

Streams the stored CV PDF for the given job.

### `GET /cv/:jobDuplicateKey/status`

Returns whether a CV has been uploaded for the given job.

### `POST /certificates/upload`

Multipart form upload (up to 10 files, 10MB each, PDF/JPEG/PNG only) plus a `jobDuplicateKey` field. Stores each certificate and associates it with the job.

### `GET /certificates/:jobDuplicateKey/status`

Returns whether certificates have been uploaded for the given job.

### `POST /cover-letters/create/text`

Body: a job plus `{ "coverLetterIds": string[] }`. Builds a prompt from the job description and the selected past cover letters, and generates a new cover letter with `gpt-5.5`. Returns `{ "coverLetter": string, "inputTokenCount": number }`.

### `POST /tokens/count`

Body: `{ "text": string, "model"?: string }`. Proxies to the Python token service and returns the token count for the given text.

### `GET /application/:jobDuplicateKey`

Renders the stored cover letter to PDF, merges it with the CV and any certificates for that job, and streams the combined `application.pdf`.

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
  companyAddress: CompanyAddress;
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

## Responsible Scraping

Scraping job search sites can be sensitive. Development should be conservative and respectful:

- Review and comply with the relevant site's terms and policies.
- Use safe polling intervals and avoid aggressive request patterns.
- Store only the data required by the application.
- Protect credentials, cookies, tokens, and session files.
- Add clear logging so scrape failures can be diagnosed without exposing secrets.
