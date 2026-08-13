import type { CoverLetterSegments } from 'cover-letter-generator';
import type { StoredCoverLetter } from '#types';

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
  return COVER_LETTER_SEGMENT_NAMES.map((segmentName) => segments[segmentName])
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
