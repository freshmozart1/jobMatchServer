import getLinkedInJobPathSegment from './getLinkedInJobPathSegment.js';
import isLinkedInHost from './isLinkedInHost.js';
import type { LinkedInUrlVariant } from '#types';

export default function isSupportedLinkedInUrl(
  url: string,
  variant: LinkedInUrlVariant,
): boolean {
  try {
    const parsedUrl = new URL(url);

    return (
      isLinkedInHost(parsedUrl.hostname) &&
      parsedUrl.protocol === 'https:' &&
      ((variant === 'jobPage' &&
        getLinkedInJobPathSegment(parsedUrl) !== null) ||
        (variant === 'jobSearchPage' &&
          (parsedUrl.pathname === '/jobs/search' ||
            parsedUrl.pathname === '/jobs/search/')))
    );
  } catch {
    return false;
  }
}
