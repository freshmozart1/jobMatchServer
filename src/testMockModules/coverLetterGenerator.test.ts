import { jest } from '@jest/globals';
import type { CoverLetterSegments } from 'cover-letter-generator';

export const segmentCoverLetter =
  jest.fn<(input: string) => Promise<{ segments: CoverLetterSegments }>>();

export function mockCoverLetterGeneratorModule() {
  jest.unstable_mockModule('cover-letter-generator', () => ({
    segmentCoverLetter,
  }));
}
