import isLinkedInHost from './isLinkedInHost.js';

export function normalizeLinkedInJobDetailUrl(href: string): string | null {
  try {
    const url = new URL(href);

    if (!isLinkedInHost(url.hostname)) {
      return null;
    }

    const pathParts = url.pathname.split('/').filter(Boolean);

    if (
      pathParts.length < 3 ||
      pathParts[0] !== 'jobs' ||
      pathParts[1] !== 'view'
    ) {
      return null;
    }

    const jobIdentifier = pathParts[2];

    if (!jobIdentifier) {
      return null;
    }

    return `https://${url.hostname.toLowerCase()}/jobs/view/${jobIdentifier}/`;
  } catch {
    return null;
  }
}
