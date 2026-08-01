import getLinkedInJobPathSegment from '#utils/getLinkedInJobPathSegment.js';
import isLinkedInHost from '#utils/isLinkedInHost.js';

export function normalizeLinkedInJobPageUrl(jobUrl: string): string | null {
    try {
        const url = new URL(jobUrl);
        const jobPathSegment = getLinkedInJobPathSegment(url);

        if (
            url.protocol !== 'https:' ||
            !isLinkedInHost(url.hostname) ||
            !jobPathSegment
        ) {
            return null;
        }

        return `https://${url.hostname.toLowerCase()}/jobs/view/${jobPathSegment}/`;
    } catch {
        return null;
    }
}
