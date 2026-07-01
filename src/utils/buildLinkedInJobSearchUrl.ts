import { LINKEDIN_JOB_SEARCH_URL } from "../constants.js";

export function buildLinkedInJobSearchUrl(
  keyword: string,
  location: string,
  distance: number,
  datePosted: string,
  pageNum: number = 0,
): string {
  const url = new URL(LINKEDIN_JOB_SEARCH_URL);

  // Pass keyword directly so URLSearchParams encodes spaces as '+' (application/x-www-form-urlencoded).
  // Replacing spaces with '+' first and then calling .set() would double-encode '+' to '%2B'.
  url.searchParams.set("keywords", keyword);
  url.searchParams.set("location", location);
  url.searchParams.set("distance", distance.toString());
  url.searchParams.set("f_TPR", `r${datePosted}`);
  url.searchParams.set("pageNum", pageNum.toString());

  return url.toString();
}
