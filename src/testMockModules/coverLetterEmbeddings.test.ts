import { jest } from '@jest/globals';
import type { StoredCoverLetter } from '#types';
import type { CoverLetterSegments } from 'cover-letter-generator';

export const createStoredCoverLetterFromTextSegments =
  jest.fn<(segments: CoverLetterSegments) => Promise<StoredCoverLetter>>();

export function mockCoverLetterEmbeddingsModule() {
  return jest.unstable_mockModule(
    '../coverLetters/coverLetterEmbeddings.js',
    () => ({
      createStoredCoverLetterFromTextSegments,
    }),
  );
}
