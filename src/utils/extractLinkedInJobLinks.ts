import { normalizeLinkedInJobDetailUrl } from './normalizeLinkedInJobDetailUrl.js';
import type { ScrapedAnchor } from '#types';

export function extractLinkedInJobLinks(anchors: ScrapedAnchor[]): string[] {
  const jobLinks = anchors.flatMap((anchor) => {
    const jobLink = normalizeLinkedInJobDetailUrl(anchor.href);

    return jobLink ? [jobLink] : [];
  });

  return Array.from(new Set(jobLinks));
}
