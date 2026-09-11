import { describe, expect, it } from '@jest/globals';
import { getLinkedInJobScraperSearchParamsFromBody } from './getLinkedInJobScraperSearchParamsFromBody.js';

const validBody = {
    keywords: ['TypeScript'],
    location: 'Berlin',
    distance: 25,
    datePosted: 'day',
};

describe('getLinkedInJobScraperSearchParamsFromBody', () => {
    it('trims and keeps a real location', () => {
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                location: '  Berlin  ',
            }),
        ).toEqual({
            keywords: ['TypeScript'],
            location: 'Berlin',
            distance: 25,
            datePosted: 'day',
        });
    });

    it('omits location when it is an empty string', () => {
        const result = getLinkedInJobScraperSearchParamsFromBody({
            ...validBody,
            location: '',
        });

        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('location');
        expect(result).toEqual({
            keywords: ['TypeScript'],
            distance: 25,
            datePosted: 'day',
        });
    });

    it('omits location when it is whitespace only', () => {
        const result = getLinkedInJobScraperSearchParamsFromBody({
            ...validBody,
            location: '   ',
        });

        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('location');
    });

    it('omits location when the key is absent entirely', () => {
        const result = getLinkedInJobScraperSearchParamsFromBody({
            keywords: ['TypeScript'],
            distance: 25,
            datePosted: 'day',
        });

        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('location');
        expect(result).toEqual({
            keywords: ['TypeScript'],
            distance: 25,
            datePosted: 'day',
        });
    });

    it('omits location when it is explicitly undefined', () => {
        const result = getLinkedInJobScraperSearchParamsFromBody({
            ...validBody,
            location: undefined,
        });

        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('location');
    });

    it('returns null for a non-string location', () => {
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                location: 42,
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                location: null,
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                location: {},
            }),
        ).toBeNull();
    });

    it('returns null for invalid keywords', () => {
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                keywords: [],
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                keywords: ['   '],
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                keywords: 42,
            }),
        ).toBeNull();
    });

    it('omits distance when the key is absent entirely', () => {
        const result = getLinkedInJobScraperSearchParamsFromBody({
            keywords: ['TypeScript'],
            location: 'Berlin',
            datePosted: 'day',
        });

        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('distance');
        expect(result).toEqual({
            keywords: ['TypeScript'],
            location: 'Berlin',
            datePosted: 'day',
        });
    });

    it('omits distance when it is explicitly undefined', () => {
        const result = getLinkedInJobScraperSearchParamsFromBody({
            ...validBody,
            distance: undefined,
        });

        expect(result).not.toBeNull();
        expect(result).not.toHaveProperty('distance');
    });

    it('returns null for an invalid distance', () => {
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                distance: 0,
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                distance: 12.5,
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                distance: '25',
            }),
        ).toBeNull();
    });

    it('returns null for an invalid datePosted', () => {
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                datePosted: 'year',
            }),
        ).toBeNull();
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                ...validBody,
                datePosted: 7,
            }),
        ).toBeNull();
    });

    it('returns null when a required key is missing or the body is not an object', () => {
        expect(
            getLinkedInJobScraperSearchParamsFromBody({
                location: 'Berlin',
                distance: 25,
                datePosted: 'day',
            }),
        ).toBeNull();
        expect(getLinkedInJobScraperSearchParamsFromBody(null)).toBeNull();
        expect(getLinkedInJobScraperSearchParamsFromBody('body')).toBeNull();
    });
});
