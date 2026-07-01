# LinkedIn Job Scraper

A continuously running Node.js server for finding new job postings on job search sites such as LinkedIn, normalizing them, and storing them in MongoDB for downstream applications.

The goal of this project is to provide the data collection service for a job management workflow. It should be able to run in the background, periodically scrape configured job searches, deduplicate known postings, and persist new jobs in a shape that another app can query.

## Project Status

This project is in early development.

Currently implemented:

- Express server entry point in `src/index.ts`
- TypeScript build configuration
- Nodemon-based development workflow
- Automatic port fallback starting from port `3000`
- Health endpoint for checking the server process
- Puppeteer-based endpoint for scraping LinkedIn job links from a search URL
- Host-routed endpoint for scraping individual LinkedIn job pages

Planned but not implemented yet:

- MongoDB persistence
- Scheduled scraping jobs
- Job normalization and deduplication
- Authenticated LinkedIn session support
- Automated tests

## Planned Architecture

The intended service architecture is:

1. **Express server** receives operational requests, exposes health/status endpoints, and keeps the process alive.
2. **Scheduler** runs configured scrape jobs continuously at a safe interval.
3. **Browser automation layer** uses Puppeteer to open job search pages and extract job posting data.
4. **Normalizer** converts scraped site-specific data into a stable internal job format.
5. **Deduplicator** detects jobs that have already been stored, usually by source URL or a source-specific job identifier.
6. **MongoDB storage layer** persists new jobs and scrape run metadata.
7. **Consumer applications** can read from MongoDB or call future service endpoints to access collected jobs.

## Technology Stack

- Node.js
- TypeScript
- Express
- Puppeteer
- MongoDB (planned)
- ESLint and Prettier
- Nodemon for local development

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build the TypeScript project:

```bash
npm run build
```

The `npm test` script is currently a placeholder and does not run a real test suite yet.

## Runtime Behavior

The current server starts on port `3000`.

If port `3000` is already in use, the server automatically tries the next port until it finds an available one.

Example startup output:

```text
Server running on http://localhost:3000
```

If the port is occupied:

```text
Port 3000 in use, trying 3001...
Server running on http://localhost:3001
```

## API Endpoints

### `GET /health`

Returns a lightweight process health response.

Example response:

```json
{
  "status": "ok"
}
```

## Planned Configuration

The scraper will likely use environment variables for runtime configuration. These values are not implemented yet, but they describe the expected direction:

```bash
PORT=3000
MONGODB_URI=mongodb://localhost:27017
MONGODB_DATABASE=job_manager
SCRAPE_INTERVAL_MINUTES=30
SCRAPER_HEADLESS=true
JOB_SEARCH_URLS=https://www.linkedin.com/jobs/search/?keywords=software%20engineer
```

If authenticated scraping is added later, credentials or session data should be handled through secure environment variables or a secret manager. They should never be hardcoded or committed to the repository.

## Job Model

Stored jobs should use a normalized format so that downstream applications do not need to understand each source site's markup.

Example shape:

```ts
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
};
```

The `duplicateKey` should be stable across scrape runs. A source job ID is ideal when available; otherwise, a normalized source URL can be used.

## Future API Surface

Future versions of the service may expose additional endpoints like:

- `GET /scrape/status` for the latest scrape run status
- `POST /scrape` to trigger a configured scrape run
- `GET /jobs/recent` to inspect recently collected jobs

## Development Notes

- Source files live in `src`.
- Compiled output is written to `dist`.
- The project uses ES modules through `"type": "module"`.
- Nodemon watches TypeScript files in `src` and runs the entry point through the `ts-node` ESM loader.
- TypeScript strict mode is enabled.
- Scraper code should keep browser automation, parsing, persistence, and scheduling concerns separated.

## Responsible Scraping

Scraping job search sites can be sensitive. Development should be conservative and respectful:

- Review and comply with the relevant site's terms and policies.
- Use safe polling intervals and avoid aggressive request patterns.
- Store only the data required by the application.
- Protect credentials, cookies, tokens, and session files.
- Prefer official APIs or permitted integrations when available.
- Add clear logging so scrape failures can be diagnosed without exposing secrets.

## Roadmap

Near-term implementation work:

1. Add environment variable loading and validation.
2. Add MongoDB connection management.
3. Add optional authenticated session support if public LinkedIn pages remain gated.
4. Normalize and deduplicate scraped job records.
5. Persist jobs and scrape run metadata.
6. Add scrape status endpoints.
7. Add tests for link extraction, normalization, deduplication, and persistence behavior.
