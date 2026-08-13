import type { CoverLetter, CoverLetterSegments } from 'cover-letter-generator';
import type { CoverLetterSegment, StoredCoverLetter } from '#types';

// Hardcoded rather than imported from 'cover-letter-generator': that
// package's index.js eagerly constructs an OpenAI client at module scope
// (dist/llm.js), so a static value import here would crash the server at
// startup whenever OPENAI_API_KEY is unset, for a fixed list that never
// changes independently of this repo's own CoverLetterSegmentName union.
const COVER_LETTER_SEGMENT_NAMES = [
    'subject',
    'salutation',
    'introduction',
    'mainBody',
    'conclusion',
    'greetings',
] as const satisfies readonly (keyof CoverLetterSegments)[];

export function reconstructCoverLetterText(
    segments: CoverLetterSegments,
): string {
    return COVER_LETTER_SEGMENT_NAMES.map(
        (segmentName) => segments[segmentName],
    )
        .filter((segmentText) => segmentText.trim().length > 0)
        .join('\n\n');
}

export function getCoverLetterTextSegments(
    coverLetter: StoredCoverLetter,
): CoverLetterSegments {
    return {
        subject: coverLetter.subject.text,
        salutation: coverLetter.salutation.text,
        introduction: coverLetter.introduction.text,
        mainBody: coverLetter.mainBody.text,
        conclusion: coverLetter.conclusion.text,
        greetings: coverLetter.greetings.text,
    };
}

function toGeneratorCoverLetterSegment(
    segment: CoverLetterSegment,
): CoverLetter[keyof CoverLetter] {
    return {
        text: segment.text,
        ...(segment.embedding !== null ? { embedding: segment.embedding } : {}),
    };
}

// The inverse of toStoredCoverLetter/toStoredCoverLetterSegment in
// src/database/uploadCoverLetterAsText.ts: maps a StoredCoverLetter (this
// repo's persisted shape, `embedding: TextEmbedding | null`) to the
// package's CoverLetter (`embedding?: TextEmbedding`).
export function toGeneratorCoverLetter(
    coverLetter: StoredCoverLetter,
): CoverLetter {
    return {
        subject: toGeneratorCoverLetterSegment(coverLetter.subject),
        salutation: toGeneratorCoverLetterSegment(coverLetter.salutation),
        introduction: toGeneratorCoverLetterSegment(coverLetter.introduction),
        mainBody: toGeneratorCoverLetterSegment(coverLetter.mainBody),
        conclusion: toGeneratorCoverLetterSegment(coverLetter.conclusion),
        greetings: toGeneratorCoverLetterSegment(coverLetter.greetings),
    };
}

export function getGeneratorCoverLetterTextSegments(
    coverLetter: CoverLetter,
): CoverLetterSegments {
    return {
        subject: coverLetter.subject.text,
        salutation: coverLetter.salutation.text,
        introduction: coverLetter.introduction.text,
        mainBody: coverLetter.mainBody.text,
        conclusion: coverLetter.conclusion.text,
        greetings: coverLetter.greetings.text,
    };
}
