import { describe, expect, it } from '@jest/globals';
import { buildLinkedInJobSearchUrl } from './buildLinkedInJobSearchUrl.js';

describe('buildLinkedInJobSearchUrl', () => {
  it('always sets pageNum to 0 (the whole list loads via scroll/click on this one page visit)', () => {
    const url = new URL(
      buildLinkedInJobSearchUrl('TypeScript', 'Berlin', 25, '86400'),
    );
    expect(url.searchParams.get('pageNum')).toBe('0');
  });

  it('encodes spaces in the keyword correctly (URLSearchParams decodes back to spaces)', () => {
    const url = new URL(
      buildLinkedInJobSearchUrl('Senior Engineer', 'Berlin', 25, '86400'),
    );
    // searchParams.get() decodes '+' back to ' ' (application/x-www-form-urlencoded).
    // The serialized URL string uses 'keywords=Senior+Engineer', which is correct.
    expect(url.searchParams.get('keywords')).toBe('Senior Engineer');
  });

  it('sets location, distance, and the f_TPR date-posted param', () => {
    const url = new URL(
      buildLinkedInJobSearchUrl('Go', 'Hamburg', 10, '604800'),
    );
    expect(url.searchParams.get('location')).toBe('Hamburg');
    expect(url.searchParams.get('distance')).toBe('10');
    expect(url.searchParams.get('f_TPR')).toBe('r604800');
  });

  it('produces a URL pointing at the LinkedIn job search path', () => {
    const url = new URL(
      buildLinkedInJobSearchUrl('Go', 'Hamburg', 10, '604800'),
    );
    expect(url.hostname).toBe('www.linkedin.com');
    expect(url.pathname).toBe('/jobs/search');
  });
});
