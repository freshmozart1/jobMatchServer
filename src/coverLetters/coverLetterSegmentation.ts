import type {
  CoverLetterSegmentName,
  CoverLetterTextSegments,
  StoredCoverLetter,
} from '#types';
import { normalizeCoverLetterText } from './coverLetterPreprocessing.js';
import { segmentCoverLetterWithLlmFallback } from './coverLetterSegmentationFallback.js';

const COVER_LETTER_SEGMENT_NAMES = [
  'subject',
  'salutation',
  'introduction',
  'mainBody',
  'conclusion',
  'greetings',
] as const satisfies readonly CoverLetterSegmentName[];

const SUBJECT_PREFIX_PATTERN = /^(?:betreff|betr\.?|subject|re)\s*[:-]/iu;
const SUBJECT_KEYWORD_PATTERN =
  /\b(?:bewerbung|application|applying|position|stelle|ausbildung|praktikum)\b/iu;
const SALUTATION_PATTERN =
  /^(?:sehr geehrte(?:r|\s+damen\s+und\s+herren|\s+frau|\s+herr)|liebe(?:r|\s)|dear\s+|to whom it may concern|dear hiring manager|dear sir or madam)/iu;
const GREETINGS_PATTERN =
  /^(?:mit freundlichen gr(?:ü|ue)ßen|freundliche gr(?:ü|ue)ße|viele gr(?:ü|ue)ße|herzliche gr(?:ü|ue)ße|beste gr(?:ü|ue)ße|kind regards|best regards|sincerely|yours faithfully|yours sincerely|regards)\b/iu;
const SENTENCE_BOUNDARY_PATTERN = /(?<=[.!?])\s+/u;

export type CoverLetterSegmentationSource = 'heuristic' | 'llm';

export type CoverLetterSegmentationResult = {
  segments: CoverLetterTextSegments;
  source: CoverLetterSegmentationSource;
  confidence: number;
  fallbackReason?: string;
};

type IndexedLine = {
  text: string;
  index: number;
};

type HeuristicSegmentationResult = {
  segments: CoverLetterTextSegments;
  confidence: number;
  fallbackReason?: string;
};

function createEmptyTextSegments(): CoverLetterTextSegments {
  return {
    subject: '',
    salutation: '',
    introduction: '',
    mainBody: '',
    conclusion: '',
    greetings: '',
  };
}

function findSubjectLine(
  lines: IndexedLine[],
  salutationIndex: number | undefined,
): IndexedLine | undefined {
  const upperSearchBound = salutationIndex ?? Math.min(lines.length, 5);

  return lines.find((line, position) => {
    if (position >= upperSearchBound || position > 4) {
      return false;
    }

    return (
      SUBJECT_PREFIX_PATTERN.test(line.text) ||
      (line.text.length <= 180 && SUBJECT_KEYWORD_PATTERN.test(line.text))
    );
  });
}

function splitParagraphs(lines: string[]): string[] {
  return lines
    .join('\n')
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0);
}

function joinNonEmptyLines(lines: string[]): string {
  return lines.filter((line) => line.trim().length > 0).join('\n');
}

function splitLastSentence(paragraph: string): {
  remainingText: string;
  lastSentence: string;
} {
  const sentences = paragraph
    .split(SENTENCE_BOUNDARY_PATTERN)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  if (sentences.length < 2) {
    return { remainingText: '', lastSentence: paragraph.trim() };
  }

  const lastSentence = sentences[sentences.length - 1];

  if (!lastSentence) {
    return { remainingText: '', lastSentence: paragraph.trim() };
  }

  return {
    remainingText: sentences.slice(0, -1).join(' '),
    lastSentence,
  };
}

function buildBodySegments(
  bodyParagraphs: string[],
): Pick<CoverLetterTextSegments, 'introduction' | 'mainBody' | 'conclusion'> {
  if (bodyParagraphs.length === 0) {
    return { introduction: '', mainBody: '', conclusion: '' };
  }

  if (bodyParagraphs.length === 1) {
    const { remainingText, lastSentence } = splitLastSentence(
      bodyParagraphs[0] ?? '',
    );
    return {
      introduction: remainingText,
      mainBody: '',
      conclusion: lastSentence,
    };
  }

  if (bodyParagraphs.length === 2) {
    return {
      introduction: bodyParagraphs[0] ?? '',
      mainBody: '',
      conclusion: bodyParagraphs[1] ?? '',
    };
  }

  return {
    introduction: bodyParagraphs[0] ?? '',
    mainBody: bodyParagraphs.slice(1, -1).join('\n\n'),
    conclusion: bodyParagraphs[bodyParagraphs.length - 1] ?? '',
  };
}

function scoreHeuristicSegments(
  segments: CoverLetterTextSegments,
  hasOrderedMarkers: boolean,
  hasMultipleBodyParagraphs: boolean,
): HeuristicSegmentationResult {
  if (!segments.salutation) {
    return {
      segments,
      confidence: 0.25,
      fallbackReason: 'salutation not found',
    };
  }

  if (!segments.greetings) {
    return {
      segments,
      confidence: 0.35,
      fallbackReason: 'greetings not found',
    };
  }

  if (!hasOrderedMarkers) {
    return {
      segments,
      confidence: 0.2,
      fallbackReason: 'salutation and greetings are not in a valid order',
    };
  }

  if (!segments.introduction || !segments.conclusion) {
    return {
      segments,
      confidence: 0.45,
      fallbackReason:
        'body could not be split into introduction and conclusion',
    };
  }

  if (!hasMultipleBodyParagraphs && !segments.mainBody) {
    return {
      segments,
      confidence: 0.55,
      fallbackReason: 'single-paragraph body without main body',
    };
  }

  return { segments, confidence: segments.mainBody ? 0.95 : 0.75 };
}

export function segmentCoverLetterHeuristically(
  input: string,
): HeuristicSegmentationResult {
  const normalizedInput = normalizeCoverLetterText(input);
  const allLines = normalizedInput.split('\n');
  const nonEmptyLines = allLines
    .map((text, index) => ({ text, index }))
    .filter((line) => line.text.length > 0);
  const salutationLine = nonEmptyLines.find((line) =>
    SALUTATION_PATTERN.test(line.text),
  );
  const greetingsLine = [...nonEmptyLines]
    .reverse()
    .find((line) => GREETINGS_PATTERN.test(line.text));
  const subjectLine = findSubjectLine(nonEmptyLines, salutationLine?.index);
  const hasOrderedMarkers =
    salutationLine !== undefined &&
    greetingsLine !== undefined &&
    salutationLine.index < greetingsLine.index;
  const bodyStartIndex = salutationLine
    ? salutationLine.index + 1
    : subjectLine
      ? subjectLine.index + 1
      : 0;
  const bodyEndIndex = greetingsLine?.index ?? allLines.length;
  const bodyLines =
    bodyStartIndex < bodyEndIndex
      ? allLines
          .slice(bodyStartIndex, bodyEndIndex)
          .filter(
            (_line, relativeIndex) =>
              bodyStartIndex + relativeIndex !== subjectLine?.index,
          )
      : [];
  const bodyParagraphs = splitParagraphs(bodyLines);
  const bodySegments = buildBodySegments(bodyParagraphs);
  const segments = {
    ...createEmptyTextSegments(),
    subject: subjectLine?.text ?? '',
    salutation: salutationLine?.text ?? '',
    ...bodySegments,
    greetings: greetingsLine
      ? joinNonEmptyLines(allLines.slice(greetingsLine.index))
      : '',
  } satisfies CoverLetterTextSegments;

  return scoreHeuristicSegments(
    segments,
    hasOrderedMarkers,
    bodyParagraphs.length > 1,
  );
}

export async function segmentCoverLetter(
  input: string,
): Promise<CoverLetterSegmentationResult> {
  const normalizedInput = normalizeCoverLetterText(input);
  const heuristicResult = segmentCoverLetterHeuristically(normalizedInput);

  if (!heuristicResult.fallbackReason) {
    return { ...heuristicResult, source: 'heuristic' };
  }

  const fallbackSegments =
    await segmentCoverLetterWithLlmFallback(normalizedInput);

  return {
    segments: fallbackSegments,
    source: 'llm',
    confidence: heuristicResult.confidence,
    fallbackReason: heuristicResult.fallbackReason,
  };
}

export function reconstructCoverLetterText(
  segments: CoverLetterTextSegments,
): string {
  return COVER_LETTER_SEGMENT_NAMES.map((segmentName) => segments[segmentName])
    .filter((segmentText) => segmentText.trim().length > 0)
    .join('\n\n');
}

export function getCoverLetterTextSegments(
  coverLetter: StoredCoverLetter,
): CoverLetterTextSegments {
  return {
    subject: coverLetter.subject.text,
    salutation: coverLetter.salutation.text,
    introduction: coverLetter.introduction.text,
    mainBody: coverLetter.mainBody.text,
    conclusion: coverLetter.conclusion.text,
    greetings: coverLetter.greetings.text,
  };
}
