import { jest } from '@jest/globals';
import type {
    CoverLetter,
    CoverLetterSegments,
    Job,
} from 'cover-letter-generator';
import type * as CoverLetterGenerator from 'cover-letter-generator';
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

export const reviseCoverLetterText =
    jest.fn<
        (input: {
            selectedText: string;
            instruction: string;
            coverLetterText: string;
            job: Job;
        }) => Promise<string>
    >();

// The real value, in the real order the adapters depend on, copied by hand:
// loading it from the package's index would construct an OpenAI client at
// import time, and its dist/ internals are off-limits as noted above.
// coverLetterAdapters.test.ts checks it against the real value at runtime.
export const COVER_LETTER_SEGMENT_NAMES: typeof CoverLetterGenerator.COVER_LETTER_SEGMENT_NAMES =
    [
        'subject',
        'salutation',
        'introduction',
        'mainBody',
        'conclusion',
        'greetings',
    ];

export function mockCoverLetterGeneratorModule() {
    // Build fails if these keys drift from the package's runtime value exports.
    // 'default' is the module.exports nodenext synthesizes for this CommonJS
    // package; nothing imports it that way, so the mock doesn't provide it.
    jest.unstable_mockModule(
        'cover-letter-generator',
        () =>
            ({
                segmentCoverLetter,
                embedCoverLetterSegments,
                embedJob,
                getTopXSimilarCoverLetters,
                generateCoverLetter,
                reviseCoverLetterText,
                COVER_LETTER_SEGMENT_NAMES,
            }) satisfies Record<
                Exclude<keyof typeof CoverLetterGenerator, 'default'>,
                unknown
            >,
    );
}
