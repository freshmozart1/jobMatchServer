import { describe, expect, it } from '@jest/globals';
import isSupportedLinkedInUrl from './isSupportedLinkedInUrl.js';

describe('isSupportedLinkedInUrl — jobPage variant', () => {
  it('accepts a valid LinkedIn job page URL', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://www.linkedin.com/jobs/view/1234567/',
        'jobPage',
      ),
    ).toBe(true);
  });

  it('accepts a URL with a slug before the numeric id', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://www.linkedin.com/jobs/view/engineer-at-acme-1234567/',
        'jobPage',
      ),
    ).toBe(true);
  });

  it('rejects http (non-https)', () => {
    expect(
      isSupportedLinkedInUrl(
        'http://www.linkedin.com/jobs/view/1234567/',
        'jobPage',
      ),
    ).toBe(false);
  });

  it('rejects a search URL when variant is jobPage', () => {
    expect(
      isSupportedLinkedInUrl('https://www.linkedin.com/jobs/search', 'jobPage'),
    ).toBe(false);
  });

  it('rejects a non-LinkedIn domain', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://example.com/jobs/view/1234567/',
        'jobPage',
      ),
    ).toBe(false);
  });
});

describe('isSupportedLinkedInUrl — jobSearchPage variant', () => {
  it('accepts /jobs/search', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://www.linkedin.com/jobs/search',
        'jobSearchPage',
      ),
    ).toBe(true);
  });

  it('accepts /jobs/search/ (trailing slash)', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://www.linkedin.com/jobs/search/',
        'jobSearchPage',
      ),
    ).toBe(true);
  });

  it('accepts a search URL with query parameters', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://www.linkedin.com/jobs/search?keywords=typescript',
        'jobSearchPage',
      ),
    ).toBe(true);
  });

  it('rejects a job-view URL when variant is jobSearchPage', () => {
    expect(
      isSupportedLinkedInUrl(
        'https://www.linkedin.com/jobs/view/1234567/',
        'jobSearchPage',
      ),
    ).toBe(false);
  });
});

describe('isSupportedLinkedInUrl — both variants', () => {
  it('returns false for an invalid URL string', () => {
    expect(isSupportedLinkedInUrl('not a url', 'jobPage')).toBe(false);
    expect(isSupportedLinkedInUrl('not a url', 'jobSearchPage')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isSupportedLinkedInUrl('', 'jobPage')).toBe(false);
  });
});
