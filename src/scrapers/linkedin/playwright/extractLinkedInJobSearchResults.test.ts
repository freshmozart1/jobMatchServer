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
import {
  clickLinkedInJobSearchResultCard,
  extractLinkedInJobDetailPane,
  extractLinkedInJobSearchResults,
  listLinkedInJobSearchResultCards,
  type LinkedInJobSearchResultCard,
} from './extractLinkedInJobSearchResults.js';

type ResponseLike = {
  url: () => string;
  ok: () => boolean;
  status: () => number;
};

function jobPostingResponse(jobId: string, status = 200): ResponseLike {
  return {
    url: () =>
      `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`,
    ok: () => status >= 200 && status < 300,
    status: () => status,
  };
}

function timeoutError(): Error {
  return Object.assign(new Error('Timeout 5000ms exceeded'), {
    name: 'TimeoutError',
  });
}

type ResponsePredicate = (response: ResponseLike) => boolean;

type PageMock = {
  evaluate: ReturnType<
    typeof jest.fn<(...args: unknown[]) => Promise<unknown>>
  >;
  waitForResponse: ReturnType<
    typeof jest.fn<
      (
        predicate: ResponsePredicate,
        options?: { timeout?: number },
      ) => Promise<ResponseLike>
    >
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
  'https://www.linkedin.com/jobs/search?keywords=frontend&currentJobId=111';

function createPageMock(): PageMock {
  return {
    evaluate: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    waitForResponse: jest
      .fn<
        (
          predicate: ResponsePredicate,
          options?: { timeout?: number },
        ) => Promise<ResponseLike>
      >()
      .mockResolvedValue(jobPostingResponse('111')),
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

// Click-dispatch evaluate calls are the only ones carrying a `cardIndex` arg
// (the card-list evaluate carries `urnAttr`, the detail-pane evaluate's
// second arg is a plain selector string) — filtering on it isolates exactly
// which cards were actually clicked, in order.
function clickedCardIndexes(page: PageMock): number[] {
  return page.evaluate.mock.calls
    .map((call) => call[1])
    .filter(
      (arg): arg is { cardIndex: number } =>
        typeof arg === 'object' && arg !== null && 'cardIndex' in arg,
    )
    .map((arg) => arg.cardIndex);
}

const sampleCards: LinkedInJobSearchResultCard[] = [
  { jobId: '111', detailUrl: 'https://www.linkedin.com/jobs/view/111/' },
  { jobId: null, detailUrl: 'https://www.linkedin.com/jobs/view/222/' },
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
  // Card skips, null-jobId cards and page aborts warn by design; keep test output clean.
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

describe('clickLinkedInJobSearchResultCard', () => {
  it('dispatches a native click on the card link anchor scoped to the given index', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    const card = sampleCards[0]!; // card with a known jobId

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.evaluate.mock.calls[0]?.[1]).toEqual({
      listSel: 'ul.jobs-search__results-list > li',
      linkSel: 'a.base-card__full-link',
      cardIndex: 0,
    });
    expect(page.waitForResponse).toHaveBeenCalledTimes(1);
  });

  it('scrolls the card into view before dispatching the click', async () => {
    // page.evaluate is fully mocked, so the in-page callback never actually
    // runs against a DOM — inspecting its source is the only way to guard
    // against this call being dropped again.
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    const card = sampleCards[0]!;

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    const callback = page.evaluate.mock.calls[0]?.[0];
    expect(typeof callback).toBe('function');
    expect(callback?.toString()).toContain('scrollIntoView');
  });

  it('throws when the card link anchor is not found at the given index', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(false);
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/could not find/);
  });

  it('classifies a missing card link as navigated-away instead of markup drift when the page already left the search results', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(false);
    page.url.mockReturnValue('https://www.linkedin.com/jobs/view/111/');
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/Navigated away from LinkedIn job search results/);
  });

  it('verifies the detail pane renders the clicked job via its job-view link', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    const card = sampleCards[0]!;

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    expect(page.waitForSelector).toHaveBeenCalledWith(
      '.two-pane-serp-page__detail-view a[href*="/jobs/view/"][href*="111"]',
      { state: 'visible', timeout: 5_000 },
    );
  });

  it('only accepts jobPosting API responses for the clicked job id', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    const card = sampleCards[0]!;

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    const predicate = page.waitForResponse.mock.calls[0]?.[0];
    expect(predicate).toBeDefined();
    if (!predicate) throw new Error('response predicate was not captured');
    expect(predicate(jobPostingResponse('111'))).toBe(true);
    expect(predicate(jobPostingResponse('999'))).toBe(false);
  });

  it('throws with the response status when the pane does not update and the API was rate-limited', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    page.waitForSelector.mockRejectedValue(timeoutError());
    page.waitForResponse.mockResolvedValue(jobPostingResponse('111', 429));
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/jobPosting API responded 429/);
  });

  it('throws a no-response classification when the pane does not update and no API response was seen', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    page.waitForSelector.mockRejectedValue(timeoutError());
    page.waitForResponse.mockRejectedValue(timeoutError());
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/no jobPosting API response was observed/);
  });

  it('classifies a navigation that only completes mid-wait as navigated-away instead of misattributing it to rate-limiting', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    page.waitForSelector.mockRejectedValue(timeoutError());
    page.url
      .mockReturnValueOnce(SEARCH_RESULTS_URL) // synchronous check right after the click
      .mockReturnValue('https://www.linkedin.com/jobs/view/111/'); // navigation finished during the wait
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/Navigated away from LinkedIn job search results/);
  });

  it('throws even when the API responded ok but the pane never rendered the job', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    page.waitForSelector.mockRejectedValue(timeoutError());
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/although the jobPosting API responded 200/);
  });

  it('skips detail-pane verification when the card has no job id', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    const card = sampleCards[1]!; // jobId: null

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 1);

    expect(page.waitForSelector).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no data-entity-urn job id'),
    );
  });

  it('does not warn when the jobPosting response watcher fails because the browser was already closed', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    page.waitForResponse.mockRejectedValue(
      new Error(
        'page.waitForResponse: Target page, context or browser has been closed',
      ),
    );
    const card = sampleCards[1]!; // jobId: null -> awaits responsePromise directly

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 1);

    expect(console.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('response watcher failed'),
    );
  });

  it('detects an unexpected navigation away from job search results immediately, without waiting on the detail pane', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValueOnce(true);
    page.url.mockReturnValue('https://www.linkedin.com/company/acme-corp/');
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/Navigated away from LinkedIn job search results/);
    expect(page.waitForSelector).not.toHaveBeenCalled();
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

describe('extractLinkedInJobSearchResults', () => {
  it('clicks through every listed card and collects its extracted detail pane', async () => {
    const page = createPageMock();
    page.evaluate
      .mockImplementationOnce(async () => sampleCards)
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted)
      .mockImplementationOnce(async () => true)
      .mockImplementationOnce(async () => sampleExtracted);

    const { results, aborted, abortReason } =
      await extractLinkedInJobSearchResults(page as unknown as Page);

    expect(results).toEqual([
      { detailUrl: sampleCards[0]!.detailUrl, extracted: sampleExtracted },
      { detailUrl: sampleCards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
    expect(abortReason).toBeUndefined();
    expect(clickedCardIndexes(page)).toEqual([0, 1]);
    expect(page.waitForResponse).toHaveBeenCalledTimes(2);
  });

  it('returns an empty result set when no cards are found', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue([]);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([]);
    expect(aborted).toBe(false);
    expect(page.waitForResponse).not.toHaveBeenCalled();
  });

  it('skips a card whose pane never updates and resets the failure streak on the next success', async () => {
    const page = createPageMock();
    const cards: LinkedInJobSearchResultCard[] = [
      { jobId: '111', detailUrl: 'https://www.linkedin.com/jobs/view/111/' },
      { jobId: '222', detailUrl: 'https://www.linkedin.com/jobs/view/222/' },
    ];
    page.evaluate
      .mockImplementationOnce(async () => cards)
      .mockImplementationOnce(async () => true) // click card 0
      .mockImplementationOnce(async () => true) // click card 1
      .mockImplementationOnce(async () => sampleExtracted); // detail pane card 1
    // First card's pane never renders its job link; second card succeeds.
    page.waitForSelector.mockRejectedValueOnce(timeoutError());

    const { results, aborted, abortReason } =
      await extractLinkedInJobSearchResults(page as unknown as Page);

    expect(results).toEqual([
      { detailUrl: cards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
    expect(abortReason).toBeUndefined();
  });

  it('aborts the page with abortReason "consecutive-failures" after three consecutive card failures instead of clicking every card', async () => {
    const page = createPageMock();
    const cards: LinkedInJobSearchResultCard[] = ['1', '2', '3', '4', '5'].map(
      (id) => ({
        jobId: id,
        detailUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      }),
    );
    page.evaluate
      .mockImplementationOnce(async () => cards)
      .mockImplementation(async () => true);
    page.waitForSelector.mockRejectedValue(timeoutError());

    const { results, aborted, abortReason } =
      await extractLinkedInJobSearchResults(page as unknown as Page);

    expect(results).toEqual([]);
    expect(aborted).toBe(true);
    expect(abortReason).toBe('consecutive-failures');
    // Cards 4 and 5 must never be clicked once the abort threshold is hit.
    expect(clickedCardIndexes(page)).toEqual([0, 1, 2]);
  });

  it('aborts the page instantly with abortReason "navigated-away" on the first bad click, without requiring 3 consecutive failures', async () => {
    const page = createPageMock();
    const cards: LinkedInJobSearchResultCard[] = ['1', '2', '3', '4', '5'].map(
      (id) => ({
        jobId: id,
        detailUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      }),
    );
    page.evaluate
      .mockImplementationOnce(async () => cards)
      .mockImplementation(async () => true);
    page.url.mockReturnValue('https://www.linkedin.com/company/acme-corp/');

    const { results, aborted, abortReason } =
      await extractLinkedInJobSearchResults(page as unknown as Page);

    expect(results).toEqual([]);
    expect(aborted).toBe(true);
    expect(abortReason).toBe('navigated-away');
    expect(clickedCardIndexes(page)).toEqual([0]);
    expect(page.waitForSelector).not.toHaveBeenCalled();
  });
});
