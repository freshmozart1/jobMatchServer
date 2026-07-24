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

const mockClearLinkedInOverlays = jest.fn<() => Promise<boolean>>();

jest.unstable_mockModule('./waitForLinkedInPage.js', () => ({
  clearLinkedInOverlays: mockClearLinkedInOverlays,
}));

const {
  clickLinkedInJobSearchResultCard,
  extractLinkedInJobDetailPane,
  extractLinkedInJobSearchResults,
  listLinkedInJobSearchResultCards,
  loadAllLinkedInJobSearchResults,
} = await import('./extractLinkedInJobSearchResults.js');

function timeoutError(): Error {
  return Object.assign(new Error('Timeout 5000ms exceeded'), {
    name: 'TimeoutError',
  });
}

type PageMock = {
  evaluate: ReturnType<
    typeof jest.fn<(...args: unknown[]) => Promise<unknown>>
  >;
  waitForSelector: ReturnType<
    typeof jest.fn<
      (
        selector: string,
        options?: { state?: string; timeout?: number },
      ) => Promise<unknown>
    >
  >;
  url: ReturnType<typeof jest.fn<() => string>>;
};

const SEARCH_RESULTS_URL =
  'https://www.linkedin.com/jobs/search?keywords=frontend';

function createPageMock(): PageMock {
  return {
    evaluate: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    waitForSelector: jest
      .fn<
        (
          selector: string,
          options?: { state?: string; timeout?: number },
        ) => Promise<unknown>
      >()
      .mockResolvedValue(undefined),
    url: jest.fn<() => string>().mockReturnValue(SEARCH_RESULTS_URL),
  };
}

// Skips the load-all mechanism entirely (its own behavior is covered by the
// loadAllLinkedInJobSearchResults describe block below) so these tests can
// focus purely on per-card scraping/staleness/retry/dedup/abort logic.
const SKIP_LOAD_ALL_OPTIONS = {
  maxScrollAttempts: 0,
  maxSeeMoreClicks: 0,
  delayBetweenJobsMs: 0,
};

function card(
  jobId: string | null,
  id = jobId ?? '0',
): LinkedInJobSearchResultCard {
  return { jobId, detailUrl: `https://www.linkedin.com/jobs/view/${id}/` };
}

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
  // Card skips, null-jobId cards, staleness and page aborts warn by design;
  // keep test output clean.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  mockClearLinkedInOverlays.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('listLinkedInJobSearchResultCards', () => {
  it('returns whatever the in-page evaluation resolves with', async () => {
    const page = createPageMock();
    const cards = [card('111'), card('222')];
    page.evaluate.mockResolvedValue(cards);

    const result = await listLinkedInJobSearchResultCards(
      page as unknown as Page,
    );

    expect(result).toEqual(cards);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe('clickLinkedInJobSearchResultCard', () => {
  it('dispatches a native click scoped to the given (title-filtered) index', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);

    const clicked = await clickLinkedInJobSearchResultCard(
      page as unknown as Page,
      2,
    );

    expect(clicked).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls[0]?.[1]).toEqual({
      listSel: 'ul.jobs-search__results-list > li',
      linkSel: 'a.base-card__full-link',
      titleSel: 'h3',
      cardIndex: 2,
    });
  });

  it('returns false when no card link anchor is found at the given index', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(false);

    const clicked = await clickLinkedInJobSearchResultCard(
      page as unknown as Page,
      0,
    );

    expect(clicked).toBe(false);
  });
});

describe('extractLinkedInJobDetailPane', () => {
  it('returns whatever the in-page evaluation resolves with', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(sampleExtracted);

    const result = await extractLinkedInJobDetailPane(page as unknown as Page);

    expect(result).toEqual(sampleExtracted);
  });
});

describe('loadAllLinkedInJobSearchResults', () => {
  it('stops the scroll phase once unique job growth is stable, without a "See more" button ever appearing', async () => {
    const page = createPageMock();
    // countUniqueJobIds -> 2, isSelectorVisible(see-more) -> false, scrollToPageBottom -> undefined,
    // repeated until 2 consecutive stable reads (stableScrollsToStop: 2).
    page.evaluate
      .mockImplementationOnce(async () => [card('1'), card('2')]) // count=2 (attempt 0)
      .mockImplementationOnce(async () => false) // see-more not visible
      .mockImplementationOnce(async () => undefined) // scroll
      .mockImplementationOnce(async () => [card('1'), card('2')]) // count=2 again -> stableReads=1
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => [card('1'), card('2')]); // count=2 again -> stableReads=2 -> stop

    await loadAllLinkedInJobSearchResults(page as unknown as Page, {
      stableScrollsToStop: 2,
      scrollSettleMs: 0,
      maxSeeMoreClicks: 0,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(7);
  });

  it('stops the scroll phase as soon as the "See more" button appears, then clicks through the click phase', async () => {
    const page = createPageMock();
    page.evaluate
      .mockImplementationOnce(async () => [card('1')]) // count=1
      .mockImplementationOnce(async () => true) // see-more visible -> stop scroll phase
      // click phase: viewed-all not visible, see-more visible, click it, poll finds growth
      .mockImplementationOnce(async () => false) // viewed-all banner
      .mockImplementationOnce(async () => true) // see-more visible
      .mockImplementationOnce(async () => true) // click succeeds
      .mockImplementationOnce(async () => [card('1'), card('2')]) // poll: count grew to 2
      // next click-phase iteration: viewed-all now visible -> stop
      .mockImplementationOnce(async () => true);

    await loadAllLinkedInJobSearchResults(page as unknown as Page, {
      scrollSettleMs: 0,
      seeMorePollIntervalMs: 0,
      seeMorePollAttempts: 1,
      stableClicksToStop: 5,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(7);
    expect(mockClearLinkedInOverlays).toHaveBeenCalledTimes(1);
  });

  it('stops the click phase after growth stalls for the configured number of stable clicks', async () => {
    const page = createPageMock();
    page.evaluate
      .mockImplementationOnce(async () => [card('1')]) // scroll count=1
      .mockImplementationOnce(async () => true) // see-more visible -> stop scroll phase
      // click-phase iteration 1: click, count unchanged (stableClicks=1)
      .mockImplementationOnce(async () => false) // viewed-all
      .mockImplementationOnce(async () => true) // see-more visible
      .mockImplementationOnce(async () => true) // click
      .mockImplementationOnce(async () => [card('1')]) // poll: unchanged
      // click-phase iteration 2: click, count unchanged again (stableClicks=2 -> stop)
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => [card('1')]);

    await loadAllLinkedInJobSearchResults(page as unknown as Page, {
      scrollSettleMs: 0,
      seeMorePollIntervalMs: 0,
      seeMorePollAttempts: 1,
      stableClicksToStop: 2,
    });

    expect(page.evaluate).toHaveBeenCalledTimes(10);
  });
});

describe('extractLinkedInJobSearchResults', () => {
  it('scrapes every listed card and collects its extracted detail pane', async () => {
    const page = createPageMock();
    const cards = [card('111'), card('222')];
    page.evaluate
      .mockImplementationOnce(async () => cards) // listLinkedInJobSearchResultCards
      // card 0
      .mockImplementationOnce(async () => 'Acme Corp') // list company
      .mockImplementationOnce(async () => true) // click
      .mockImplementationOnce(async () => sampleExtracted) // pane extract
      // card 1
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([
      { detailUrl: cards[0]!.detailUrl, extracted: sampleExtracted },
      { detailUrl: cards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
  });

  it('returns an empty result set when no cards are found', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue([]);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([]);
    expect(aborted).toBe(false);
  });

  it('treats a pane-confirmation timeout as stale rather than a hard failure, and retries it', async () => {
    const page = createPageMock();
    const c = card('111');
    page.waitForSelector.mockRejectedValueOnce(timeoutError());
    page.evaluate
      .mockImplementationOnce(async () => [c])
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted)
      // retry pass: pane confirms in time this time
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([
      { detailUrl: c.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
    expect(page.waitForSelector).toHaveBeenCalledTimes(2);
  });

  it('skips a job id already scraped earlier in this request, without re-clicking it', async () => {
    const page = createPageMock();
    const repeated = card('111');
    page.evaluate
      .mockImplementationOnce(async () => [repeated, repeated]) // same job served twice
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toHaveLength(1);
    // 1 list call + 3 calls for the single scraped card = 4 total.
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it('treats a card with no job id as confirmed after a settle delay, without calling waitForSelector', async () => {
    const page = createPageMock();
    const noIdCard = card(null, 'unknown');
    page.evaluate
      .mockImplementationOnce(async () => [noIdCard])
      .mockImplementationOnce(async () => null) // no list company
      .mockImplementationOnce(async () => true) // click
      .mockImplementationOnce(async () => sampleExtracted);

    const { results } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([
      { detailUrl: noIdCard.detailUrl, extracted: sampleExtracted },
    ]);
    expect(page.waitForSelector).not.toHaveBeenCalled();
  });

  it('confirms the pane update via a job-id-scoped selector on the two-pane detail view', async () => {
    const page = createPageMock();
    const c = card('111');
    page.evaluate
      .mockImplementationOnce(async () => [c])
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(page.waitForSelector).toHaveBeenCalledWith(
      '.two-pane-serp-page__detail-view a[href*="/jobs/view/"][href*="111"]',
      { state: 'visible', timeout: 5_000 },
    );
  });

  it('flags a card stale on company mismatch and retries it once after the full pass, replacing the result on success', async () => {
    const page = createPageMock();
    const c = card('111');
    page.evaluate
      .mockImplementationOnce(async () => [c])
      // first pass: list company disagrees with pane company -> stale
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => ({
        ...sampleExtracted,
        company: 'Wrong Co',
      }))
      // retry pass: pane now agrees
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.extracted.company).toBe('Acme Corp');
  });

  it('keeps the first-pass (stale) result when the retry itself fails', async () => {
    const page = createPageMock();
    const c = card('111');
    const staleExtracted = { ...sampleExtracted, company: 'Wrong Co' };
    page.evaluate
      .mockImplementationOnce(async () => [c])
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => staleExtracted)
      // retry pass: click fails outright
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => false);

    const { results } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([
      { detailUrl: c.detailUrl, extracted: staleExtracted },
    ]);
  });

  it('flags a card stale when an overlay is still up right after reading its data, and retries it', async () => {
    const page = createPageMock();
    const c = card('111');
    mockClearLinkedInOverlays
      .mockResolvedValueOnce(false) // pre-click clear: nothing there
      .mockResolvedValueOnce(true) // post-read clear: caught a late overlay
      .mockResolvedValue(false); // retry pass: clean
    page.evaluate
      .mockImplementationOnce(async () => [c])
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted)
      // retry pass
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toHaveLength(1);
    // First pass (2 clear calls) + retry pass (2 clear calls).
    expect(mockClearLinkedInOverlays).toHaveBeenCalledTimes(4);
  });

  it('aborts immediately on an unexpected navigation away from the results page, keeping partial results', async () => {
    const page = createPageMock();
    const cards = [card('1'), card('2'), card('3')];
    page.evaluate
      .mockImplementationOnce(async () => cards)
      // card 0 succeeds
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted)
      // card 1: click "succeeds" but the page actually navigated away
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true);
    page.url
      .mockReturnValueOnce(SEARCH_RESULTS_URL) // card 0's check
      .mockReturnValueOnce('https://www.linkedin.com/company/acme-corp/'); // card 1's check

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([
      { detailUrl: cards[0]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(true);
    // Card 2 must never be attempted.
    expect(page.evaluate).toHaveBeenCalledTimes(6);
  });

  it('aborts after three consecutive card failures instead of clicking every remaining card, keeping partial results', async () => {
    const page = createPageMock();
    const cards = [card('1'), card('2'), card('3'), card('4'), card('5')];
    page.evaluate
      .mockImplementationOnce(async () => cards)
      // card 0 succeeds
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted)
      // cards 1-3: click can't find the card link anchor (markup drift) -> 3 consecutive failures
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => 'Acme Corp')
      .mockImplementationOnce(async () => false);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
      SKIP_LOAD_ALL_OPTIONS,
    );

    expect(results).toEqual([
      { detailUrl: cards[0]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(true);
    // Card 4 (index 4) must never be attempted once the abort threshold hits.
    expect(page.evaluate).toHaveBeenCalledTimes(10);
  });
});
