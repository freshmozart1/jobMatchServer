import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Page } from 'playwright';
import type { ExtractedLinkedInJobPage } from '#types';
import type { LinkedInJobSearchResultCard } from './extractLinkedInJobSearchResults.js';

const mockDismissLinkedInSignInModalIfPresent =
  jest.fn<(page: Page) => Promise<void>>();

jest.unstable_mockModule('./waitForLinkedInPage.js', () => ({
  dismissLinkedInSignInModalIfPresent: mockDismissLinkedInSignInModalIfPresent,
}));

const {
  extractLinkedInJobDetailPage,
  extractLinkedInJobSearchResults,
  listLinkedInJobSearchResultCards,
  scrapeLinkedInJobDetailPage,
} = await import('./extractLinkedInJobSearchResults.js');

type PageMock = {
  evaluate: ReturnType<
    typeof jest.fn<(...args: unknown[]) => Promise<unknown>>
  >;
  goto: ReturnType<
    typeof jest.fn<
      (
        url: string,
        options?: { waitUntil?: string; timeout?: number },
      ) => Promise<unknown>
    >
  >;
  waitForSelector: ReturnType<
    typeof jest.fn<
      (selector: string, options?: { timeout?: number }) => Promise<unknown>
    >
  >;
};

function createPageMock(): PageMock {
  return {
    evaluate: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    goto: jest
      .fn<
        (
          url: string,
          options?: { waitUntil?: string; timeout?: number },
        ) => Promise<unknown>
      >()
      .mockResolvedValue(undefined),
    waitForSelector: jest
      .fn<
        (selector: string, options?: { timeout?: number }) => Promise<unknown>
      >()
      .mockResolvedValue(undefined),
  };
}

const sampleCards: LinkedInJobSearchResultCard[] = [
  { jobId: '111', detailUrl: 'https://www.linkedin.com/jobs/view/111/' },
  { jobId: '222', detailUrl: 'https://www.linkedin.com/jobs/view/222/' },
];

const sampleExtracted: ExtractedLinkedInJobPage = {
  title: 'Software Engineer',
  company: 'Acme Corp',
  location: 'Berlin, Germany',
  descriptionText: 'A great job.',
  postedAt: '1 day ago',
  tags: ['Full-time'],
  companyPageUrl: 'https://www.linkedin.com/company/acme-corp/',
};

beforeEach(() => {
  // Card skips and page aborts warn by design; keep test output clean.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('listLinkedInJobSearchResultCards', () => {
  it('returns whatever the in-page evaluation resolves with', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(sampleCards);

    const result = await listLinkedInJobSearchResultCards(
      page as unknown as Page,
    );

    expect(result).toEqual(sampleCards);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('extractLinkedInJobDetailPage', () => {
  it('returns whatever the in-page evaluation resolves with', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(sampleExtracted);

    const result = await extractLinkedInJobDetailPage(page as unknown as Page);

    expect(result).toEqual(sampleExtracted);
  });
});

describe('scrapeLinkedInJobDetailPage', () => {
  it('throws when the card has no detail URL', async () => {
    const page = createPageMock();
    const card: LinkedInJobSearchResultCard = { jobId: '111', detailUrl: null };

    await expect(
      scrapeLinkedInJobDetailPage(page as unknown as Page, card),
    ).rejects.toThrow(/no detail URL/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('navigates directly to the job detail URL, dismisses the sign-in modal, waits for the top card, then extracts', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(sampleExtracted);
    const card = sampleCards[0]!;

    const result = await scrapeLinkedInJobDetailPage(
      page as unknown as Page,
      card,
    );

    expect(page.goto).toHaveBeenCalledWith(card.detailUrl!, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    expect(mockDismissLinkedInSignInModalIfPresent).toHaveBeenCalledWith(
      page as unknown as Page,
    );
    expect(page.waitForSelector).toHaveBeenCalledWith('.top-card-layout', {
      timeout: 5_000,
    });
    expect(result).toEqual(sampleExtracted);
  });

  it('propagates a navigation failure', async () => {
    const page = createPageMock();
    page.goto.mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));
    const card = sampleCards[0]!;

    await expect(
      scrapeLinkedInJobDetailPage(page as unknown as Page, card),
    ).rejects.toThrow(/ERR_NAME_NOT_RESOLVED/);
  });

  it('propagates a failure to find the top card on the destination page', async () => {
    const page = createPageMock();
    page.waitForSelector.mockRejectedValue(
      Object.assign(new Error('Timeout 5000ms exceeded'), {
        name: 'TimeoutError',
      }),
    );
    const card = sampleCards[0]!;

    await expect(
      scrapeLinkedInJobDetailPage(page as unknown as Page, card),
    ).rejects.toThrow(/Timeout/);
  });
});

describe('extractLinkedInJobSearchResults', () => {
  it('navigates to every listed card and collects its extracted detail page', async () => {
    const page = createPageMock();
    page.evaluate
      .mockImplementationOnce(async () => sampleCards)
      .mockImplementationOnce(async () => sampleExtracted)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([
      { detailUrl: sampleCards[0]!.detailUrl, extracted: sampleExtracted },
      { detailUrl: sampleCards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
    expect(page.goto).toHaveBeenCalledTimes(2);
    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      sampleCards[0]!.detailUrl!,
      expect.anything(),
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      sampleCards[1]!.detailUrl!,
      expect.anything(),
    );
  });

  it('returns an empty result set when no cards are found', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue([]);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([]);
    expect(aborted).toBe(false);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('skips a card whose detail page fails to load and resets the failure streak on the next success', async () => {
    const page = createPageMock();
    page.evaluate
      .mockImplementationOnce(async () => sampleCards)
      .mockImplementationOnce(async () => sampleExtracted);
    // First card's navigation fails; second card succeeds.
    page.goto.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_RESET'));

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([
      { detailUrl: sampleCards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
  });

  it('aborts the page after three consecutive failures instead of visiting every card, but keeps partial results', async () => {
    const page = createPageMock();
    const cards: LinkedInJobSearchResultCard[] = ['1', '2', '3', '4', '5'].map(
      (id) => ({
        jobId: id,
        detailUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      }),
    );
    page.evaluate.mockImplementationOnce(async () => cards);
    page.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'));

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([]);
    expect(aborted).toBe(true);
    // Cards 4 and 5 must never be visited once the abort threshold is hit.
    expect(page.goto).toHaveBeenCalledTimes(3);
  });
});
