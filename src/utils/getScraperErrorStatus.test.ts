import { describe, expect, it } from '@jest/globals';
import { getScraperErrorStatus } from './getScraperErrorStatus.js';

describe('getScraperErrorStatus', () => {
  it('returns 504 when the error message mentions a timeout', () => {
    expect(getScraperErrorStatus(new Error('Navigation timeout'))).toBe(504);
  });

  it('matches the word "timeout" case-insensitively', () => {
    expect(getScraperErrorStatus(new Error('Request TIMEOUT exceeded'))).toBe(
      504,
    );
  });

  it('returns 502 for a generic Error', () => {
    expect(getScraperErrorStatus(new Error('Something went wrong'))).toBe(502);
  });

  it('returns 502 for a non-Error thrown value', () => {
    expect(getScraperErrorStatus('a string error')).toBe(502);
    expect(getScraperErrorStatus(null)).toBe(502);
    expect(getScraperErrorStatus(undefined)).toBe(502);
  });
});
