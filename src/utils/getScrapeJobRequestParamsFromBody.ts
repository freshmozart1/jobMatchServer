import { getLinkedInJobLinkSearchParamsFromBody } from './getLinkedInJobLinkSearchParamsFromBody.js';
import type { ScrapeJobRequestParams } from '#types';

export function getScrapeJobRequestParamsFromBody(
  body: unknown,
): ScrapeJobRequestParams | null {
  const baseParams = getLinkedInJobLinkSearchParamsFromBody(body);

  if (
    !baseParams ||
    !body ||
    typeof body !== 'object' ||
    !('maxPages' in body)
  ) {
    return null;
  }

  const maxPages = body.maxPages;

  if (
    typeof maxPages !== 'number' ||
    !Number.isFinite(maxPages) ||
    !Number.isInteger(maxPages) ||
    maxPages < 0
  ) {
    return null;
  }

  return { ...baseParams, maxPages };
}
