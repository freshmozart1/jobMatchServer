import { getTrimmedUniqueKeywords } from './getTrimmedUniqueKeywords.js';

const REQUIRED_KEYS = ['keywords', 'distance', 'datePosted'] as const;

type ValidatableBody = Record<(typeof REQUIRED_KEYS)[number], unknown> & {
    location?: unknown;
};

function hasRequiredKeys(body: unknown): body is ValidatableBody {
    return (
        typeof body === 'object' &&
        body !== null &&
        REQUIRED_KEYS.every((key) => key in body)
    );
}

function isValidDistance(distance: unknown): distance is number {
    return (
        typeof distance === 'number' &&
        Number.isFinite(distance) &&
        Number.isInteger(distance) &&
        distance > 0
    );
}

function isValidDatePosted(
    datePosted: unknown,
): datePosted is 'day' | 'month' | 'week' {
    return (
        typeof datePosted === 'string' &&
        ['day', 'month', 'week'].includes(datePosted)
    );
}

// `location` is deliberately optional (#143), unlike every other field here:
// linkedin-job-scraper declares it as `location?: string` and its `buildSearchUrl` simply
// omits the query param when the field is `undefined`, while the jobMatch UI labels the
// field "Location (optional)" and sends `''` when it is blank. Absent, `undefined`, and
// blank-after-trim all mean "no location", and the key is left off the result entirely so
// the caller can spread it straight into the scraper's search params. A non-string,
// non-`undefined` location is still rejected, so garbage keeps producing a 400 rather than
// being silently coerced away.
function getValidatedKeywordsAndLocation(body: {
    keywords: unknown;
    location?: unknown;
}): { keywords: string[]; location?: string } | null {
    const trimmedKeywords = getTrimmedUniqueKeywords(body.keywords);

    if (!trimmedKeywords) {
        return null;
    }

    if (body.location !== undefined && typeof body.location !== 'string') {
        return null;
    }

    const trimmedLocation = body.location?.trim();

    return {
        keywords: trimmedKeywords,
        ...(trimmedLocation ? { location: trimmedLocation } : {}),
    };
}

function getValidatedDistanceAndDatePosted(body: {
    distance: unknown;
    datePosted: unknown;
}): { distance: number; datePosted: 'day' | 'month' | 'week' } | null {
    if (
        !isValidDistance(body.distance) ||
        !isValidDatePosted(body.datePosted)
    ) {
        return null;
    }

    return { distance: body.distance, datePosted: body.datePosted };
}

export function getLinkedInJobScraperSearchParamsFromBody(body: unknown): {
    keywords: string[];
    location?: string;
    datePosted: 'day' | 'month' | 'week';
    distance: number;
} | null {
    if (!hasRequiredKeys(body)) {
        return null;
    }

    const keywordsAndLocation = getValidatedKeywordsAndLocation(body);
    const distanceAndDatePosted = getValidatedDistanceAndDatePosted(body);

    if (!keywordsAndLocation || !distanceAndDatePosted) {
        return null;
    }

    return { ...keywordsAndLocation, ...distanceAndDatePosted };
}
