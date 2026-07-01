import { describe, expect, it } from '@jest/globals';
import { getScrapeJobRequestParamsFromBody } from './getScrapeJobRequestParamsFromBody.js';

const validBaseBody = {
  keywords: 'TypeScript',
  location: 'Berlin',
  distance: 25,
  datePosted: '86400',
};

describe('getScrapeJobRequestParamsFromBody', () => {
  it('returns merged params for a valid body with maxPages: 0', () => {
    expect(
      getScrapeJobRequestParamsFromBody({ ...validBaseBody, maxPages: 0 }),
    ).toEqual({
      keywords: ['TypeScript'],
      location: 'Berlin',
      distance: 25,
      datePosted: '86400',
      maxPages: 0,
    });
  });

  it('returns merged params for a valid body with a positive maxPages', () => {
    expect(
      getScrapeJobRequestParamsFromBody({ ...validBaseBody, maxPages: 3 }),
    ).toEqual({
      keywords: ['TypeScript'],
      location: 'Berlin',
      distance: 25,
      datePosted: '86400',
      maxPages: 3,
    });
  });

  it('returns null when maxPages is missing', () => {
    expect(getScrapeJobRequestParamsFromBody(validBaseBody)).toBeNull();
  });

  it('returns null when maxPages is negative', () => {
    expect(
      getScrapeJobRequestParamsFromBody({ ...validBaseBody, maxPages: -1 }),
    ).toBeNull();
  });

  it('returns null when maxPages is a float', () => {
    expect(
      getScrapeJobRequestParamsFromBody({ ...validBaseBody, maxPages: 1.5 }),
    ).toBeNull();
  });

  it('returns null when maxPages is not a number', () => {
    expect(
      getScrapeJobRequestParamsFromBody({ ...validBaseBody, maxPages: '1' }),
    ).toBeNull();
  });

  it('returns null when the base params are invalid even if maxPages is valid', () => {
    expect(
      getScrapeJobRequestParamsFromBody({
        location: 'Berlin',
        distance: 25,
        datePosted: '86400',
        maxPages: 1,
      }),
    ).toBeNull();
  });

  it('returns null for a non-object body', () => {
    expect(getScrapeJobRequestParamsFromBody(null)).toBeNull();
    expect(getScrapeJobRequestParamsFromBody('string')).toBeNull();
  });
});
