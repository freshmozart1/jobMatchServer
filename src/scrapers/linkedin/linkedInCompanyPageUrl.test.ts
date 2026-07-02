import { describe, expect, it } from '@jest/globals';
import { normalizeLinkedInCompanyPageUrl } from './linkedInCompanyPageUrl.js';

describe('normalizeLinkedInCompanyPageUrl', () => {
  it('returns a locale-agnostic key for a canonical company URL', () => {
    expect(
      normalizeLinkedInCompanyPageUrl(
        'https://www.linkedin.com/company/acme-corp/',
      ),
    ).toBe('company/acme-corp');
  });

  it('merges locale subdomain variants into the same key', () => {
    const uk = normalizeLinkedInCompanyPageUrl(
      'https://uk.linkedin.com/company/quantumblack?trk=public_jobs_topcard-org-name',
    );
    const de = normalizeLinkedInCompanyPageUrl(
      'https://de.linkedin.com/company/quantumblack/',
    );
    const www = normalizeLinkedInCompanyPageUrl(
      'https://www.linkedin.com/company/quantumblack',
    );

    expect(uk).toBe(de);
    expect(de).toBe(www);
  });

  it('strips query params implicitly via the pathname-only key', () => {
    expect(
      normalizeLinkedInCompanyPageUrl(
        'https://www.linkedin.com/company/acme-corp/?trk=guest',
      ),
    ).toBe('company/acme-corp');
  });

  it('lowercases the slug', () => {
    expect(
      normalizeLinkedInCompanyPageUrl(
        'https://www.linkedin.com/company/Acme-Corp/',
      ),
    ).toBe('company/acme-corp');
  });

  it('falls back to the raw URL for a /school/ page', () => {
    const url = 'https://www.linkedin.com/school/some-university/';
    expect(normalizeLinkedInCompanyPageUrl(url)).toBe(url);
  });

  it('falls back to the raw URL for a non-LinkedIn host', () => {
    const url = 'https://www.example.com/company/acme-corp/';
    expect(normalizeLinkedInCompanyPageUrl(url)).toBe(url);
  });

  it('falls back to the raw URL for a malformed URL string', () => {
    const url = 'not a url';
    expect(normalizeLinkedInCompanyPageUrl(url)).toBe(url);
  });

  it('falls back to the raw URL when the path has no slug segment', () => {
    const url = 'https://www.linkedin.com/company/';
    expect(normalizeLinkedInCompanyPageUrl(url)).toBe(url);
  });
});
