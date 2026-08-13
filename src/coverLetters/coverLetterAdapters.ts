import {
  COVER_LETTER_SEGMENT_NAMES,
  type CoverLetterSegments,
} from 'cover-letter-generator';
import type { StoredCoverLetter } from '#types';

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
