import { describe, expect, it } from '@jest/globals';
import { getTrimmedUniqueKeywords } from './getTrimmedUniqueKeywords.js';

describe('getTrimmedUniqueKeywords', () => {
  it('wraps a single string in an array', () => {
    expect(getTrimmedUniqueKeywords('TypeScript')).toEqual(['TypeScript']);
  });

  it('trims and deduplicates an array of keywords', () => {
    expect(
      getTrimmedUniqueKeywords(['TypeScript', '  TypeScript  ', 'Go']),
    ).toEqual(['TypeScript', 'Go']);
  });

  it('returns null for an empty array', () => {
    expect(getTrimmedUniqueKeywords([])).toBeNull();
  });

  it('returns null for a non-array, non-string value', () => {
    expect(getTrimmedUniqueKeywords(42)).toBeNull();
    expect(getTrimmedUniqueKeywords(null)).toBeNull();
    expect(getTrimmedUniqueKeywords(undefined)).toBeNull();
  });

  it('returns null when an array element is not a string', () => {
    expect(getTrimmedUniqueKeywords(['TypeScript', 42])).toBeNull();
  });

  it('returns null when an array element is empty after trimming', () => {
    expect(getTrimmedUniqueKeywords(['TypeScript', '   '])).toBeNull();
  });
});
