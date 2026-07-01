import { describe, expect, it } from '@jest/globals';
import { extractLinkedInJobLinks } from './extractLinkedInJobLinks.js';
import type { ScrapedAnchor } from '#types';

function anchor(href: string): ScrapedAnchor {
  return { href, text: '', parentClassNames: [], nearbyText: '' };
}

describe('extractLinkedInJobLinks', () => {
  it('returns an empty array for an empty input', () => {
    expect(extractLinkedInJobLinks([])).toEqual([]);
  });

  it('extracts only normalizable LinkedIn job links', () => {
    expect(
      extractLinkedInJobLinks([
        anchor('https://www.linkedin.com/jobs/view/1234567/'),
        anchor('https://example.com/jobs/view/1234567/'),
        anchor('https://www.linkedin.com/company/acme/'),
      ]),
    ).toEqual(['https://www.linkedin.com/jobs/view/1234567/']);
  });

  it('deduplicates normalized links', () => {
    expect(
      extractLinkedInJobLinks([
        anchor('https://www.linkedin.com/jobs/view/1234567/'),
        anchor('https://www.linkedin.com/jobs/view/1234567'),
        anchor('https://WWW.LinkedIn.com/jobs/view/1234567/'),
      ]),
    ).toEqual(['https://www.linkedin.com/jobs/view/1234567/']);
  });
});
