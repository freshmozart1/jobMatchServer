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
import {
  coalesceText,
  normalizeDescription,
  extractJobTitle,
} from '../linkedInTextUtils.js';
import { computeJobMatch } from '../linkedInJobSimilarity.js';
import { createJobEmbedding } from '../../../embeddings/jobEmbedding.js';
import type {
  ExtractedLinkedInJobPage,
  ScrapedJob,
  ScrapeJobResponseBody,
  StoredScrapedJob,
} from '#types';

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
      const jobs: ScrapedJob[] = [];
      const pendingRetry: Array<{
        result: {
          detailUrl: string | null;
          extracted: ExtractedLinkedInJobPage;
        };
        normalizedUrl: string;
      }> = [];
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
          const results = await extractLinkedInJobSearchResults(page);

          if (results.length === 0) {
            break;
          }

          for (const result of results) {
            const normalizedUrl = result.detailUrl
              ? normalizeLinkedInJobPageUrl(result.detailUrl)
              : null;

            if (!normalizedUrl) {
              console.warn(
                `Skipping job card with an unresolvable detail URL on ${pageUrl}`,
              );
              continue;
            }

            if (!result.extracted.companyPageUrl) {
              console.warn(
                `Skipping job ${normalizedUrl}: no company page link found.`,
              );
              continue;
            }

            try {
              const sourceJobId = extractLinkedInJobId(normalizedUrl);
              const normalizedUrlObject = new URL(normalizedUrl);
              const title = coalesceText(
                extractJobTitle(result.extracted.title),
              );
              const company = coalesceText(result.extracted.company);
              const descriptionText = normalizeDescription(
                result.extracted.descriptionText,
              );

              const maybeAddress = await extractCompanyAddress(
                result.extracted.companyPageUrl,
              ).catch((addressError: unknown) => {
                console.log(
                  `Company address extraction failed for ${normalizedUrl}, scheduling retry: ${addressError instanceof Error ? addressError.message : String(addressError)}`,
                );
                pendingRetry.push({ result, normalizedUrl });
                return null;
              });

              if (maybeAddress !== null) {
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
                  duplicateKey: sourceJobId
                    ? `linkedin:${sourceJobId}`
                    : normalizedUrl,
                  companyAddress: maybeAddress,
                };

                const embedding = await createJobEmbedding(jobFields);
                const match = await computeJobMatch(client, embedding);

                jobs.push({
                  ...jobFields,
                  embedding,
                  ...(match !== undefined ? { match } : {}),
                });
              }
            } catch (jobError) {
              console.warn(
                `Skipping job ${normalizedUrl}: ${jobError instanceof Error ? jobError.message : String(jobError)}`,
              );
            }
          }
        } finally {
          await closeTrackedBrowserServer(browserServer);
        }

        pageNum += 1;
      }

      for (const { result, normalizedUrl } of pendingRetry) {
        console.log(
          `Retrying company address extraction for ${normalizedUrl}...`,
        );
        try {
          const companyAddress = await extractCompanyAddress(
            result.extracted.companyPageUrl,
          );
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
            duplicateKey: sourceJobId
              ? `linkedin:${sourceJobId}`
              : normalizedUrl,
            companyAddress,
          };
          const embedding = await createJobEmbedding(jobFields);
          const match = await computeJobMatch(client, embedding);
          jobs.push({
            ...jobFields,
            embedding,
            ...(match !== undefined ? { match } : {}),
          });
          console.log(`Company address retry succeeded for ${normalizedUrl}.`);
        } catch (retryError) {
          console.log(
            `Company address retry failed for ${normalizedUrl}: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
          );
        }
      }

      let newJobs = jobs;
      if (jobs.length > 0) {
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
        newJobs = jobs.filter((job) => !existingKeys.has(job.duplicateKey));
        if (newJobs.length < jobs.length) {
          console.log(
            `Filtered ${jobs.length - newJobs.length} already-stored job(s) from "${keyword}" results.`,
          );
        }
      }
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
