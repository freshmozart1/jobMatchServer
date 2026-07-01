import { afterEach, describe, expect, it } from '@jest/globals';
import { collectAnchorsFromDocument } from './collectAnchorsFromDocument.js';

type FakeContextElement = {
  className?: string;
  textContent?: string | null;
};

type FakeAnchor = {
  href: string;
  textContent: string | null;
  closest: (selector: string) => FakeContextElement | null;
  getAttribute: (name: string) => string | null;
};

function createFakeAnchor(
  overrides: Partial<FakeAnchor> & { href: string },
): FakeAnchor {
  return {
    textContent: null,
    closest: () => null,
    getAttribute: () => null,
    ...overrides,
  };
}

function stubDocument(anchors: FakeAnchor[]): void {
  (globalThis as { document?: unknown }).document = {
    querySelectorAll: () => anchors,
  };
}

describe('collectAnchorsFromDocument', () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('returns an empty anchors array when there are no anchors', () => {
    stubDocument([]);
    expect(collectAnchorsFromDocument()).toEqual({ anchors: [] });
  });

  it('maps an anchor with no surrounding context', () => {
    stubDocument([
      createFakeAnchor({
        href: 'https://www.linkedin.com/jobs/view/1234567/',
        textContent: '  Software Engineer  ',
      }),
    ]);

    expect(collectAnchorsFromDocument()).toEqual({
      anchors: [
        {
          href: 'https://www.linkedin.com/jobs/view/1234567/',
          text: 'Software Engineer',
          ariaLabel: undefined,
          parentClassNames: [],
          nearbyText: '',
        },
      ],
    });
  });

  it('derives parentClassNames and nearbyText from the closest context element', () => {
    stubDocument([
      createFakeAnchor({
        href: 'https://www.linkedin.com/jobs/view/1234567/',
        textContent: 'Title',
        closest: () => ({
          className: 'job-card  highlighted',
          textContent: 'Job card  body text',
        }),
      }),
    ]);

    const { anchors } = collectAnchorsFromDocument();
    expect(anchors[0]?.parentClassNames).toEqual(['job-card', 'highlighted']);
    expect(anchors[0]?.nearbyText).toBe('Job card body text');
  });

  it('trims and normalizes the aria-label, omitting it when blank', () => {
    stubDocument([
      createFakeAnchor({
        href: 'https://www.linkedin.com/jobs/view/1/',
        getAttribute: (name) =>
          name === 'aria-label' ? '  Apply now  ' : null,
      }),
      createFakeAnchor({
        href: 'https://www.linkedin.com/jobs/view/2/',
        getAttribute: () => '',
      }),
    ]);

    const { anchors } = collectAnchorsFromDocument();
    expect(anchors[0]?.ariaLabel).toBe('Apply now');
    expect(anchors[1]?.ariaLabel).toBeUndefined();
  });
});
