import { jest } from '@jest/globals';
import type { CoverLetterTextSegments, StoredCoverLetter } from '#types';

export const createStoredCoverLetterFromTextSegments =
  jest.fn<(segments: CoverLetterTextSegments) => Promise<StoredCoverLetter>>();

export function mockCoverLetterEmbeddingsModule() {
  return jest.unstable_mockModule(
    '../coverLetters/coverLetterEmbeddings.js',
    () => ({
      createStoredCoverLetterFromTextSegments,
    }),
  );
}
