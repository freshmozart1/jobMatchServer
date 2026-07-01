import { getTrimmedUniqueKeywords } from './getTrimmedUniqueKeywords.js';
import type { LinkedInJobLinkSearchParams } from '#types';

const VALID_DATE_POSTED_VALUES = new Set(['86400', '604800', '2592000']);

export function getLinkedInJobLinkSearchParamsFromBody(
  body: unknown,
): LinkedInJobLinkSearchParams | null {
  if (
    !body ||
    typeof body !== 'object' ||
    !('keywords' in body) ||
    !('location' in body) ||
    !('distance' in body) ||
    !('datePosted' in body)
  ) {
    return null;
  }

  const keywords = body.keywords;
  const location = body.location;
  const distance = body.distance;
  const datePosted = body.datePosted;

  if (typeof location !== 'string') {
    return null;
  }

  const trimmedKeywords = getTrimmedUniqueKeywords(keywords);
  const trimmedLocation = location.trim();

  if (!trimmedKeywords || trimmedLocation.length === 0) {
    return null;
  }

  if (
    typeof distance !== 'number' ||
    !Number.isFinite(distance) ||
    !Number.isInteger(distance) ||
    distance <= 0
  ) {
    return null;
  }

  if (
    typeof datePosted !== 'string' ||
    !VALID_DATE_POSTED_VALUES.has(datePosted.trim())
  ) {
    return null;
  }

  return {
    keywords: trimmedKeywords,
    location: trimmedLocation,
    distance,
    datePosted: datePosted.trim(),
  };
}
