import { jest } from '@jest/globals';
import type * as CoverLetterGenerator from 'cover-letter-generator';

// Each mock is typed from the package's own signature, so a changed parameter
// or return type fails the build at the test whose mocked value no longer
// fits, rather than the mock silently drifting from the package.
export const segmentCoverLetter =
    jest.fn<typeof CoverLetterGenerator.segmentCoverLetter>();

export const embedCoverLetterSegments =
    jest.fn<typeof CoverLetterGenerator.embedCoverLetterSegments>();

export const embedJob = jest.fn<typeof CoverLetterGenerator.embedJob>();

export const getTopXSimilarCoverLetters =
    jest.fn<typeof CoverLetterGenerator.getTopXSimilarCoverLetters>();

export const generateCoverLetter =
    jest.fn<typeof CoverLetterGenerator.generateCoverLetter>();

export const reviseCoverLetterText =
    jest.fn<typeof CoverLetterGenerator.reviseCoverLetterText>();

// The real value, in the real order the adapters depend on, copied by hand:
// loading it from the package's index would construct an OpenAI client at
// import time, and this mock avoids deep-importing from its dist/ internals.
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
    // Build fails if these keys drift from the package's runtime value exports,
    // or if a value's type drifts from its export's. 'default' is the
    // module.exports nodenext synthesizes for this CommonJS package; nothing
    // imports it that way, so the mock doesn't provide it.
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
            }) satisfies Omit<typeof CoverLetterGenerator, 'default'>,
    );
}
