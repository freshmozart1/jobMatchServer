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

// Unlike every other field here, `location` is deliberately optional (#143):
// linkedin-job-scraper declares it as `location?: string` and its `buildSearchUrl` simply
// omits the query param when the field is `undefined`, while the jobMatch UI labels the
// field "Location (optional)" and sends `''` when it is blank. So absent and `undefined`
// are both accepted — but anything else that isn't a string is still rejected, keeping the
// 400 for garbage input rather than silently coercing it away.
function isValidLocation(location: unknown): location is string | undefined {
    return location === undefined || typeof location === 'string';
}

// Absent, `undefined`, and blank-after-trim all mean "no location", and the key is then
// left off the result entirely rather than set to `''`, so the caller can spread it
// straight into the scraper's search params and have the query param omitted.
function getValidatedKeywordsAndLocation(body: {
    keywords: unknown;
    location?: unknown;
}): { keywords: string[]; location?: string } | null {
    const trimmedKeywords = getTrimmedUniqueKeywords(body.keywords);

    if (!trimmedKeywords || !isValidLocation(body.location)) {
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
