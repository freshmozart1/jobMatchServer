import { jest } from '@jest/globals';
import type {
    CoverLetter,
    CoverLetterSegments,
    Job,
} from 'cover-letter-generator';
import type { TextEmbedding } from '#types';

// 'cover-letter-generator' doesn't export CoverLetterSimilarityMatch from
// its public index, so it's redefined locally rather than deep-importing
// from the package's dist/ internals.
type CoverLetterSimilarityMatch = {
    coverLetter: CoverLetter;
    similarity: number;
};

export const segmentCoverLetter =
    jest.fn<(input: string) => Promise<{ segments: CoverLetterSegments }>>();

export const embedCoverLetterSegments =
    jest.fn<(segments: CoverLetterSegments) => Promise<CoverLetter>>();

export const embedJob = jest.fn<(job: Job) => Promise<TextEmbedding>>();

export const getTopXSimilarCoverLetters =
    jest.fn<
        (
            x: number,
            jobEmbedding: TextEmbedding,
            coverLetters: CoverLetter[],
        ) => Promise<CoverLetterSimilarityMatch[]>
    >();

export const generateCoverLetter =
    jest.fn<
        (
            job: Job,
            exampleCoverLetters: CoverLetterSegments[],
        ) => Promise<CoverLetter>
    >();

export function mockCoverLetterGeneratorModule() {
    jest.unstable_mockModule('cover-letter-generator', () => ({
        segmentCoverLetter,
        embedCoverLetterSegments,
        embedJob,
        getTopXSimilarCoverLetters,
        generateCoverLetter,
    }));
}
