import waitForLinkedInPage from './waitForLinkedInPage.js';
import isSupportedLinkedInUrl from '#utils/isSupportedLinkedInUrl.js';
import { createErrorMessage } from '../../errors/createErrorMessage.js';
import { getLinkedInJobLinkSearchParamsFromBody } from '#utils/getLinkedInJobLinkSearchParamsFromBody.js';
import { getScraperErrorStatus } from '#utils/getScraperErrorStatus.js';
import { buildLinkedInJobSearchUrl } from '#utils/buildLinkedInJobSearchUrl.js';
import { extractLinkedInJobLinks } from '#utils/extractLinkedInJobLinks.js';
import { collectAnchorsFromDocument } from '#utils/collectAnchorsFromDocument.js';
import type { Request, Response } from 'express';
import type { Browser, Page } from 'puppeteer';
import type { LinkedInJobLinksByKeyword, ScrapedAnchor } from '#types';

type InspectedPage = {
  anchors: ScrapedAnchor[];
};

const VALID_DATE_POSTED_VALUES = new Set(['86400', '604800', '2592000']);

export async function scrapeLinkedInJobLinks(
  request: Request,
  response: Response,
): Promise<void> {
  const searchParams = getLinkedInJobLinkSearchParamsFromBody(request.body);
  const unsupportedUrlError = new Error(
    'Only LinkedIn jobs search URLs are supported.',
  );
  const unsupportedSearchParamsError = new Error(
    `Invalid search parameters. Please ensure keywords is a non-empty string or non-empty string array, location is a non-empty string, distance is a positive integer, and datePosted is one of: ${[...VALID_DATE_POSTED_VALUES].join(', ')}.`,
  );

  try {
    if (!searchParams) throw unsupportedSearchParamsError;

    const jobLinksByKeyword: LinkedInJobLinksByKeyword = Object.create(
      null,
    ) as LinkedInJobLinksByKeyword;

    for (const keywordSearchUrl of searchParams.keywords.map((keyword) => {
      const searchUrl = buildLinkedInJobSearchUrl(
        keyword,
        searchParams.location,
        searchParams.distance,
        searchParams.datePosted,
      );

      if (!isSupportedLinkedInUrl(searchUrl, 'jobSearchPage'))
        throw unsupportedUrlError;

      return { keyword, searchUrl };
    })) {
      let browser: Browser | null = null;
      try {
        const { browser: renderedBrowser, page } = await waitForLinkedInPage(
          keywordSearchUrl.searchUrl,
        );
        browser = renderedBrowser;

        const inspectedPage = await inspectRenderedAnchors(page);

        jobLinksByKeyword[keywordSearchUrl.keyword] = extractLinkedInJobLinks(
          inspectedPage.anchors,
        );
      } finally {
        if (browser) {
          await browser.close();
        }
      }
    }

    response.status(200).json(jobLinksByKeyword);
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Failed to scrape LinkedIn job links.',
      getScraperErrorStatus(error),
    );
  }
}

// TODO: #16 Refactor return

async function inspectRenderedAnchors(page: Page): Promise<InspectedPage> {
  return page.evaluate(collectAnchorsFromDocument);
}
