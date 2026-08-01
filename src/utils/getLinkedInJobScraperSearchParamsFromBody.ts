import { getTrimmedUniqueKeywords } from './getTrimmedUniqueKeywords.js';

const REQUIRED_KEYS = [
    'keywords',
    'location',
    'distance',
    'datePosted',
] as const;

function hasRequiredKeys(
    body: unknown,
): body is Record<(typeof REQUIRED_KEYS)[number], unknown> {
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

function getValidatedKeywordsAndLocation(body: {
    keywords: unknown;
    location: unknown;
}): { keywords: string[]; location: string } | null {
    const trimmedKeywords = getTrimmedUniqueKeywords(body.keywords);
    const trimmedLocation =
        typeof body.location === 'string' ? body.location.trim() : '';

    if (!trimmedKeywords || trimmedLocation.length === 0) {
        return null;
    }

    return { keywords: trimmedKeywords, location: trimmedLocation };
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
    location: string;
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
