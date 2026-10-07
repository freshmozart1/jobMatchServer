import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { getTopXSimilarCoverLetters } from 'cover-letter-generator';
import type { StoredCoverLetter } from '#types';
import { toGeneratorCoverLetter } from './coverLetterAdapters.js';

function storedLetter(text: string, embedding: number[]): StoredCoverLetter {
    return {
        subject: { text: '', embedding: null },
        salutation: { text: '', embedding: null },
        introduction: { text: '', embedding: null },
        mainBody: { text, embedding },
        conclusion: { text: '', embedding: null },
        greetings: { text: '', embedding: null },
        jobDuplicateKey: text,
    };
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe('installed generator ranking', () => {
    it.each([1, 1e300, 1e-300])(
        'ranks adapted stored letters with finite scores at scale %s without provider calls',
        async (scale) => {
            const fetch = jest
                .spyOn(globalThis, 'fetch')
                .mockRejectedValue(new Error('Provider calls are forbidden'));
            const aligned = toGeneratorCoverLetter(
                storedLetter('Aligned example', [scale, scale]),
            );
            const orthogonal = toGeneratorCoverLetter(
                storedLetter('Orthogonal example', [scale, -scale]),
            );
            const opposite = toGeneratorCoverLetter(
                storedLetter('Opposite example', [-scale, -scale]),
            );

            // Use the real package and its real transitive cosine dependency.
            // Missing embeddings are omitted by the server's actual adapter.
            const ranked = await getTopXSimilarCoverLetters(
                3,
                [scale, scale],
                [opposite, orthogonal, aligned],
            );

            expect(ranked).toHaveLength(3);
            expect(ranked[0]?.coverLetter).toBe(aligned);
            expect(ranked[1]?.coverLetter).toBe(orthogonal);
            expect(ranked[2]?.coverLetter).toBe(opposite);
            expect(
                ranked.every(({ similarity }) => Number.isFinite(similarity)),
            ).toBe(true);
            expect(ranked[0]?.similarity).toBeCloseTo(1);
            expect(ranked[1]?.similarity).toBeCloseTo(0);
            expect(ranked[2]?.similarity).toBeCloseTo(-1);
            expect(fetch).not.toHaveBeenCalled();
        },
    );
});
