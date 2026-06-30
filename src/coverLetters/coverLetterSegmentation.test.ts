import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { CoverLetterTextSegments } from '#types';

const llmFallbackSegments = {
  subject: 'Application as Software Engineer',
  salutation: 'Dear Hiring Manager,',
  introduction: 'I am excited to apply.',
  mainBody: 'I have relevant experience.',
  conclusion: 'I look forward to hearing from you.',
  greetings: 'Best regards\nOle',
} satisfies CoverLetterTextSegments;
const segmentCoverLetterWithLlmFallback =
  jest.fn<
    (normalizedCoverLetterText: string) => Promise<CoverLetterTextSegments>
  >();

jest.unstable_mockModule('./coverLetterSegmentationFallback.js', () => ({
  segmentCoverLetterWithLlmFallback,
}));

const { segmentCoverLetter, segmentCoverLetterHeuristically } =
  await import('./coverLetterSegmentation.js');

describe('cover letter segmentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    segmentCoverLetterWithLlmFallback.mockResolvedValue(llmFallbackSegments);
  });

  it('segments a German cover letter with subject, salutation, body, and greetings', () => {
    const result =
      segmentCoverLetterHeuristically(`Betreff: Bewerbung als Fachinformatiker

Sehr geehrte Frau Schiller,

ich möchte mich mit großer Motivation bewerben.

In meinen Projekten arbeite ich mit TypeScript, Node.js und modernen Entwicklungsprozessen.

Über eine Einladung zu einem persönlichen Gespräch freue ich mich sehr.

Mit freundlichen Grüßen
Ole`);

    expect(result.fallbackReason).toBeUndefined();
    expect(result.segments).toEqual({
      subject: 'Betreff: Bewerbung als Fachinformatiker',
      salutation: 'Sehr geehrte Frau Schiller,',
      introduction: 'ich möchte mich mit großer Motivation bewerben.',
      mainBody:
        'In meinen Projekten arbeite ich mit TypeScript, Node.js und modernen Entwicklungsprozessen.',
      conclusion:
        'Über eine Einladung zu einem persönlichen Gespräch freue ich mich sehr.',
      greetings: 'Mit freundlichen Grüßen\nOle',
    });
  });

  it('does not require a subject line', () => {
    const result = segmentCoverLetterHeuristically(`Dear Hiring Manager,

I am excited to apply for the role.

My background includes backend services and testing.

I would welcome the opportunity to speak with you.

Best regards
Ole`);

    expect(result.fallbackReason).toBeUndefined();
    expect(result.segments.subject).toBe('');
    expect(result.segments.salutation).toBe('Dear Hiring Manager,');
    expect(result.segments.greetings).toBe('Best regards\nOle');
  });

  it('uses the LLM fallback when heuristic confidence is low', async () => {
    const input =
      'This is an unusual one paragraph application without conventional markers.';

    const result = await segmentCoverLetter(input);

    expect(segmentCoverLetterWithLlmFallback).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      segments: llmFallbackSegments,
      source: 'llm',
      confidence: 0.25,
      fallbackReason: 'salutation not found',
    });
  });
});
