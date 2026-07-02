import isLinkedInHost from '#utils/isLinkedInHost.js';

// Purely a cache-key deriver, not a validity gate (unlike normalizeLinkedInJobPageUrl,
// which returns null so the caller can skip an unusable job) — a URL that can't be
// resolved to a /company/<slug> path falls back to the raw string unchanged, which
// still dedupes exact repeats without ever risking merging two different entities.
// The locale subdomain is deliberately dropped (unlike the job-URL normalizer, which
// preserves it): LinkedIn renders the same company under different locale hosts
// depending on which job's search found it (e.g. uk.linkedin.com vs de.linkedin.com).
export function normalizeLinkedInCompanyPageUrl(
  companyPageUrl: string,
): string {
  try {
    const url = new URL(companyPageUrl);
    if (url.protocol !== 'https:' || !isLinkedInHost(url.hostname)) {
      return companyPageUrl;
    }
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2 || pathParts[0] !== 'company') {
      return companyPageUrl;
    }
    return `company/${pathParts[1]!.toLowerCase()}`;
  } catch {
    return companyPageUrl;
  }
}
