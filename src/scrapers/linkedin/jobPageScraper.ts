import type { Request, Response } from 'express';
import type { Browser } from 'puppeteer';
import { getScraperErrorStatus } from '#utils/getScraperErrorStatus.js';
import isSupportedLinkedInUrl from '#utils/isSupportedLinkedInUrl.js';
import waitForLinkedInPage from './waitForLinkedInPage.js';
import { extractLinkedInJobPage } from './extractLinkedInJobPage.js';
import {
  normalizeLinkedInJobPageUrl,
  extractLinkedInJobId,
} from './linkedInJobPageUrl.js';
import { extractCompanyAddress } from './linkedInCompanyAddress.js';
import {
  coalesceText,
  normalizeDescription,
  extractJobTitle,
  getTitleFromPageTitle,
  getCompanyFromPageTitle,
} from './linkedInTextUtils.js';
import { computeJobMatch } from './linkedInJobSimilarity.js';
import { createJobEmbedding } from '../../embeddings/jobEmbedding.js';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  MONGODB_CONNECTION,
} from '#database/database.js';
import { createErrorMessage } from '../../errors/createErrorMessage.js';

export async function scrapeLinkedInJobPage(
  request: Request,
  response: Response,
): Promise<void> {
  const jobUrl = getUrlFromBody(request.body);
  const bodyHasNoUrlError = new Error(
    'Request body must include a valid string url.',
  );
  const unsupportedUrlError = new Error(
    'No job page scraper is registered for this URL.',
  );
  const couldntNormalizeUrlError = new Error(
    'Could not normalize LinkedIn job page URL.',
  );

  if (!connectionStringConfigured(response)) return;

  if (!jobUrl) {
    createErrorMessage(
      response,
      bodyHasNoUrlError,
      'Failed to scrape job page.',
      400,
    );
    return;
  }
  if (!isSupportedLinkedInUrl(jobUrl, 'jobPage')) {
    createErrorMessage(
      response,
      unsupportedUrlError,
      'Failed to scrape job page.',
      422,
    );
    return;
  }

  const client = new MongoClient(MONGODB_CONNECTION!);
  let browser: Browser | null = null;

  try {
    await client.connect();
    const { browser: renderedBrowser, page } =
      await waitForLinkedInPage(jobUrl);
    browser = renderedBrowser;

    const extractedJobPage = await extractLinkedInJobPage(page);
    const pageTitle = await page.title();
    const normalizedUrl =
      normalizeLinkedInJobPageUrl(page.url()) ??
      normalizeLinkedInJobPageUrl(jobUrl);

    if (!normalizedUrl) throw couldntNormalizeUrlError;

    const normalizedUrlObject = new URL(normalizedUrl);
    const sourceJobId = extractLinkedInJobId(normalizedUrl);
    const title = coalesceText(
      extractJobTitle(extractedJobPage.title),
      getTitleFromPageTitle(pageTitle),
    );
    const company = coalesceText(
      extractedJobPage.company,
      getCompanyFromPageTitle(pageTitle),
    );
    const descriptionText = normalizeDescription(
      extractedJobPage.descriptionText,
    );
    const companyAddress = await extractCompanyAddress(
      page,
      extractedJobPage.companyPageUrl,
    );

    const jobFields = {
      sourceHostname: normalizedUrlObject.hostname,
      ...(sourceJobId ? { sourceJobId } : {}),
      sourceUrl: normalizedUrl,
      title,
      company,
      ...(extractedJobPage.location
        ? { location: extractedJobPage.location }
        : {}),
      ...(descriptionText ? { descriptionText } : {}),
      ...(extractedJobPage.postedAt
        ? { postedAt: extractedJobPage.postedAt }
        : {}),
      scrapedAt: new Date().toISOString(),
      ...(extractedJobPage.tags.length > 0
        ? { tags: extractedJobPage.tags }
        : {}),
      duplicateKey: sourceJobId ? `linkedin:${sourceJobId}` : normalizedUrl,
      companyAddress,
    };

    const embedding = await createJobEmbedding(jobFields);
    const match = await computeJobMatch(client, embedding);
    response.status(200).json({
      ...jobFields,
      embedding,
      ...(match !== undefined ? { match } : {}),
    });
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Failed to scrape job page.',
      getScraperErrorStatus(error),
    );
  } finally {
    if (browser) {
      await browser.close();
    }
    await client.close();
  }
}

export function getUrlFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('url' in body)) {
    return null;
  }

  const url = body.url;

  if (typeof url !== 'string' || url.trim().length === 0) {
    return null;
  }

  try {
    return new URL(url.trim()).toString();
  } catch {
    return null;
  }
}
