import { jest } from '@jest/globals';

export const calculateCosineSimilarity = jest.fn();

export function mockCalculateCosineSimilarityModule() {
  return jest.unstable_mockModule(
    '../embeddings/calculateCosineSimilarity.js',
    () => ({
      default: calculateCosineSimilarity,
    }),
  );
}
