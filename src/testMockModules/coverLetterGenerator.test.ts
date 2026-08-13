import { jest } from '@jest/globals';
import type { CoverLetter, CoverLetterSegments } from 'cover-letter-generator';

export const segmentCoverLetter =
  jest.fn<(input: string) => Promise<{ segments: CoverLetterSegments }>>();

export const embedCoverLetterSegments =
  jest.fn<(segments: CoverLetterSegments) => Promise<CoverLetter>>();

export function mockCoverLetterGeneratorModule() {
  jest.unstable_mockModule('cover-letter-generator', () => ({
    segmentCoverLetter,
    embedCoverLetterSegments,
  }));
}
