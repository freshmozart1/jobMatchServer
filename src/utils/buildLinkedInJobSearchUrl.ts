import { LINKEDIN_JOB_SEARCH_URL } from '../constants.js';

export function buildLinkedInJobSearchUrl(
  keyword: string,
  location: string,
  distance: number,
  datePosted: string,
): string {
  const url = new URL(LINKEDIN_JOB_SEARCH_URL);

  // Pass keyword directly so URLSearchParams encodes spaces as '+' (application/x-www-form-urlencoded).
  // Replacing spaces with '+' first and then calling .set() would double-encode '+' to '%2B'.
  url.searchParams.set('keywords', keyword);
  url.searchParams.set('location', location);
  url.searchParams.set('distance', distance.toString());
  url.searchParams.set('f_TPR', `r${datePosted}`);
  // The whole result list loads via infinite-scroll/"See more" clicks on this
  // one page visit (see extractLinkedInJobSearchResults.ts) rather than by
  // reloading the URL per page, so pageNum is always 0.
  url.searchParams.set('pageNum', '0');

  return url.toString();
}
