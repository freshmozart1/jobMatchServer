import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from '#database/database.js';
import { createErrorMessage } from '../../../errors/createErrorMessage.js';
import { getScrapeJobRequestParamsFromBody } from '#utils/getScrapeJobRequestParamsFromBody.js';
import { buildLinkedInJobSearchUrl } from '#utils/buildLinkedInJobSearchUrl.js';
import { getScraperErrorStatus } from '#utils/getScraperErrorStatus.js';
import isSupportedLinkedInUrl from '#utils/isSupportedLinkedInUrl.js';
import { closeTrackedBrowserServer } from '#utils/trackedPlaywrightBrowsers.js';
import waitForLinkedInPage from './waitForLinkedInPage.js';
import { extractLinkedInJobSearchResults } from './extractLinkedInJobSearchResults.js';
import { extractCompanyAddress } from './extractCompanyAddress.js';
import {
  normalizeLinkedInJobPageUrl,
  extractLinkedInJobId,
} from '../linkedInJobPageUrl.js';
import { normalizeLinkedInCompanyPageUrl } from '../linkedInCompanyPageUrl.js';
import {
  coalesceText,
  normalizeDescription,
  extractJobTitle,
} from '../linkedInTextUtils.js';
import { computeJobMatch } from '../linkedInJobSimilarity.js';
import { createJobEmbedding } from '../../../embeddings/jobEmbedding.js';
import type {
  CompanyAddress,
  ExtractedLinkedInJobPage,
  ScrapedJob,
  ScrapeJobResponseBody,
  StoredScrapedJob,
} from '#types';

type PendingScrapedJob = {
  detailUrl: string | null;
  extracted: ExtractedLinkedInJobPage;
};

// A job whose company-address extraction failed on the first pass and is
// queued for the single deduped retry attempt made for its company.
type JobPendingCompanyAddressRetry = {
  result: PendingScrapedJob;
  normalizedUrl: string;
};

// One company's retry queue: the page URL to retry extraction against, plus
// every job from that company waiting on the result.
type CompanyAddressRetryQueue = {
  companyPageUrl: string;
  entries: JobPendingCompanyAddressRetry[];
};

// Recreated every keyword iteration: a company that fails (even after retry)
// only stays "known failed" for the rest of THIS keyword, so later keywords
// still get a fresh attempt at it. Jobs are collected per keyword so they can
// be deduped against already-stored jobs once, after pagination completes.
type KeywordScrapeState = {
  jobs: ScrapedJob[];
  companyAddressFailures: Set<string>;
  // Keyed by company so multiple jobs from the same never-before-seen company
  // that fail first-pass extraction share a single deduped retry attempt.
  pendingRetry: Map<string, CompanyAddressRetryQueue>;
};

async function buildScrapedJob(
  client: MongoClient,
  result: PendingScrapedJob,
  normalizedUrl: string,
  companyAddress: CompanyAddress,
): Promise<ScrapedJob> {
  const sourceJobId = extractLinkedInJobId(normalizedUrl);
  const normalizedUrlObject = new URL(normalizedUrl);
  const title = coalesceText(extractJobTitle(result.extracted.title));
  const company = coalesceText(result.extracted.company);
  const descriptionText = normalizeDescription(
    result.extracted.descriptionText,
  );

  const jobFields = {
    sourceHostname: normalizedUrlObject.hostname,
    ...(sourceJobId ? { sourceJobId } : {}),
    sourceUrl: normalizedUrl,
    title,
    company,
    ...(result.extracted.location
      ? { location: result.extracted.location }
      : {}),
    ...(descriptionText ? { descriptionText } : {}),
    ...(result.extracted.postedAt
      ? { postedAt: result.extracted.postedAt }
      : {}),
    scrapedAt: new Date().toISOString(),
    ...(result.extracted.tags.length > 0
      ? { tags: result.extracted.tags }
      : {}),
    duplicateKey: sourceJobId ? `linkedin:${sourceJobId}` : normalizedUrl,
    companyAddress,
  };

  const embedding = await createJobEmbedding(jobFields);
  const match = await computeJobMatch(client, embedding);

  return {
    ...jobFields,
    embedding,
    ...(match !== undefined ? { match } : {}),
  };
}

async function processSearchResult(
  client: MongoClient,
  result: PendingScrapedJob,
  pageUrl: string,
  companyAddressCache: Map<string, CompanyAddress>,
  state: KeywordScrapeState,
): Promise<void> {
  const normalizedUrl = result.detailUrl
    ? normalizeLinkedInJobPageUrl(result.detailUrl)
    : null;

  if (!normalizedUrl) {
    console.warn(
      `Skipping job card with an unresolvable detail URL on ${pageUrl}`,
    );
    return;
  }

  if (!result.extracted.companyPageUrl) {
    console.warn(`Skipping job ${normalizedUrl}: no company page link found.`);
    return;
  }

  try {
    const companyKey = normalizeLinkedInCompanyPageUrl(
      result.extracted.companyPageUrl,
    );

    if (state.companyAddressFailures.has(companyKey)) {
      console.warn(
        `Skipping job ${normalizedUrl}: company address previously failed to resolve for this keyword.`,
      );
      return;
    }

    const cachedAddress = companyAddressCache.get(companyKey);
    if (cachedAddress !== undefined) {
      state.jobs.push(
        await buildScrapedJob(client, result, normalizedUrl, cachedAddress),
      );
      return;
    }

    const existingPendingEntry = state.pendingRetry.get(companyKey);
    if (existingPendingEntry !== undefined) {
      // Another job for this company already failed first-pass
      // extraction this keyword and is queued for one deduped retry —
      // piggyback on it instead of attempting extraction again.
      existingPendingEntry.entries.push({ result, normalizedUrl });
      return;
    }

    const address = await extractCompanyAddress(
      result.extracted.companyPageUrl,
    ).catch((addressError: unknown) => {
      console.log(
        `Company address extraction failed for ${normalizedUrl}, scheduling retry: ${addressError instanceof Error ? addressError.message : String(addressError)}`,
      );
      state.pendingRetry.set(companyKey, {
        companyPageUrl: result.extracted.companyPageUrl,
        entries: [{ result, normalizedUrl }],
      });
      return null;
    });

    if (address !== null) {
      companyAddressCache.set(companyKey, address);
      state.jobs.push(
        await buildScrapedJob(client, result, normalizedUrl, address),
      );
    }
  } catch (jobError) {
    console.warn(
      `Skipping job ${normalizedUrl}: ${jobError instanceof Error ? jobError.message : String(jobError)}`,
    );
  }
}

async function resolvePendingRetries(
  client: MongoClient,
  companyAddressCache: Map<string, CompanyAddress>,
  state: KeywordScrapeState,
): Promise<void> {
  for (const [companyKey, { companyPageUrl, entries }] of state.pendingRetry) {
    console.log(
      `Retrying company address extraction for company ${companyKey} (${entries.length} job(s))...`,
    );
    try {
      const companyAddress = await extractCompanyAddress(companyPageUrl);
      companyAddressCache.set(companyKey, companyAddress);
      for (const { result, normalizedUrl } of entries) {
        try {
          state.jobs.push(
            await buildScrapedJob(
              client,
              result,
              normalizedUrl,
              companyAddress,
            ),
          );
          console.log(`Company address retry succeeded for ${normalizedUrl}.`);
        } catch (jobError) {
          console.warn(
            `Skipping job ${normalizedUrl}: ${jobError instanceof Error ? jobError.message : String(jobError)}`,
          );
        }
      }
    } catch (retryError) {
      state.companyAddressFailures.add(companyKey);
      for (const { normalizedUrl } of entries) {
        console.log(
          `Company address retry failed for ${normalizedUrl}: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
      }
    }
  }
}

async function filterNewJobs(
  client: MongoClient,
  keyword: string,
  jobs: ScrapedJob[],
): Promise<ScrapedJob[]> {
  if (jobs.length === 0) return jobs;

  const existingKeys = new Set(
    (
      await getCollection<StoredScrapedJob>(client, 'jobs')
        .find(
          { duplicateKey: { $in: jobs.map((j) => j.duplicateKey) } },
          { projection: { duplicateKey: 1, _id: 0 } },
        )
        .toArray()
    ).map((doc) => doc.duplicateKey),
  );
  const newJobs = jobs.filter((job) => !existingKeys.has(job.duplicateKey));
  if (newJobs.length < jobs.length) {
    console.log(
      `Filtered ${jobs.length - newJobs.length} already-stored job(s) from "${keyword}" results.`,
    );
  }
  return newJobs;
}

export async function scrapeJob(
  request: Request,
  response: Response,
): Promise<void> {
  const searchParams = getScrapeJobRequestParamsFromBody(request.body);

  if (!searchParams) {
    createErrorMessage(
      response,
      new Error(
        'Invalid search parameters. Please ensure keywords is a non-empty string or non-empty string array, location is a non-empty string, distance is a positive integer, datePosted is one of: 86400, 604800, 2592000, and maxPages is a non-negative integer.',
      ),
      'Failed to scrape LinkedIn job links.',
      400,
    );
    return;
  }

  if (!connectionStringConfigured(response)) return;

  const client = new MongoClient(MONGODB_CONNECTION!);
  const responseBody: ScrapeJobResponseBody = Object.create(
    null,
  ) as ScrapeJobResponseBody;
  // Resolved company addresses are reused for the whole request — a company's real
  // address doesn't change mid-scrape, so caching across keywords is a pure win.
  const companyAddressCache = new Map<string, CompanyAddress>();

  try {
    await client.connect();

    for (const keyword of searchParams.keywords) {
      const firstPageUrl = buildLinkedInJobSearchUrl(
        keyword,
        searchParams.location,
        searchParams.distance,
        searchParams.datePosted,
        0,
      );
      const state: KeywordScrapeState = {
        jobs: [],
        companyAddressFailures: new Set(),
        pendingRetry: new Map(),
      };
      let pageNum = 0;

      while (searchParams.maxPages === 0 || pageNum < searchParams.maxPages) {
        const pageUrl = buildLinkedInJobSearchUrl(
          keyword,
          searchParams.location,
          searchParams.distance,
          searchParams.datePosted,
          pageNum,
        );

        if (!isSupportedLinkedInUrl(pageUrl, 'jobSearchPage')) {
          throw new Error('Only LinkedIn jobs search URLs are supported.');
        }

        const { browserServer, page } = await waitForLinkedInPage(pageUrl);

        try {
          const { results, aborted, abortReason } =
            await extractLinkedInJobSearchResults(page);

          if (results.length === 0) {
            break;
          }

          for (const result of results) {
            await processSearchResult(
              client,
              result,
              pageUrl,
              companyAddressCache,
              state,
            );
          }

          // The aborted page's partial results above are still processed either way.
          if (aborted) {
            if (abortReason === 'navigated-away') {
              // Page-local DOM corruption from a single misclicked card — not
              // a systemic block. The next pageNum iteration already opens a
              // brand-new browser/page, so just continue pagination.
              console.warn(
                `Card extraction on this page for "${keyword}" hit an unexpected navigation; continuing to the next page.`,
              );
            } else {
              console.warn(
                `Stopping pagination for "${keyword}" — card extraction aborted after repeated failures.`,
              );
              break;
            }
          }
        } finally {
          await closeTrackedBrowserServer(browserServer);
        }

        pageNum += 1;
      }

      await resolvePendingRetries(client, companyAddressCache, state);

      const newJobs = await filterNewJobs(client, keyword, state.jobs);
      responseBody[keyword] = { searchUrl: firstPageUrl, jobs: newJobs };
    }

    response.status(200).json(responseBody);
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Failed to scrape LinkedIn jobs.',
      getScraperErrorStatus(error),
    );
  } finally {
    await client.close();
  }
}
