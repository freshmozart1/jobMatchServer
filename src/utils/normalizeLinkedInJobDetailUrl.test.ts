import { describe, expect, it } from '@jest/globals';
import { normalizeLinkedInJobDetailUrl } from './normalizeLinkedInJobDetailUrl.js';

describe('normalizeLinkedInJobDetailUrl', () => {
  it('normalizes a canonical job view URL', () => {
    expect(
      normalizeLinkedInJobDetailUrl(
        'https://www.linkedin.com/jobs/view/1234567/',
      ),
    ).toBe('https://www.linkedin.com/jobs/view/1234567/');
  });

  it('lowercases the hostname', () => {
    expect(
      normalizeLinkedInJobDetailUrl(
        'https://WWW.LinkedIn.com/jobs/view/1234567/',
      ),
    ).toBe('https://www.linkedin.com/jobs/view/1234567/');
  });

  it('adds a trailing slash when missing', () => {
    expect(
      normalizeLinkedInJobDetailUrl(
        'https://www.linkedin.com/jobs/view/1234567',
      ),
    ).toBe('https://www.linkedin.com/jobs/view/1234567/');
  });

  it('returns null for a non-LinkedIn host', () => {
    expect(
      normalizeLinkedInJobDetailUrl('https://example.com/jobs/view/1234567/'),
    ).toBeNull();
  });

  it('returns null for a malformed URL string', () => {
    expect(normalizeLinkedInJobDetailUrl('not a url')).toBeNull();
  });

  it('returns null when the path has fewer than 3 segments', () => {
    expect(
      normalizeLinkedInJobDetailUrl('https://www.linkedin.com/jobs/view'),
    ).toBeNull();
  });

  it('returns null when the path does not start with jobs/view', () => {
    expect(
      normalizeLinkedInJobDetailUrl(
        'https://www.linkedin.com/company/acme/1234567/',
      ),
    ).toBeNull();
  });
});
