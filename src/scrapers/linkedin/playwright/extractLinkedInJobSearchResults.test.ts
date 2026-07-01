import { describe, expect, it, jest } from '@jest/globals';
import type { Page } from 'playwright';
import type { ExtractedLinkedInJobPage } from '#types';
import {
  clickLinkedInJobSearchResultCard,
  extractLinkedInJobDetailPane,
  extractLinkedInJobSearchResults,
  listLinkedInJobSearchResultCards,
  type LinkedInJobSearchResultCard,
} from './extractLinkedInJobSearchResults.js';

type ClickableLocatorMock = {
  click: ReturnType<
    typeof jest.fn<(options?: { timeout?: number }) => Promise<void>>
  >;
};

type LocatorMock = ClickableLocatorMock & {
  first: ReturnType<typeof jest.fn<() => ClickableLocatorMock>>;
  nth: ReturnType<typeof jest.fn<(index: number) => ClickableLocatorMock>>;
};

function createLocatorMock(): LocatorMock {
  const click = jest
    .fn<(options?: { timeout?: number }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const locator: LocatorMock = {
    click,
    first: jest.fn<() => ClickableLocatorMock>(),
    nth: jest.fn<(index: number) => ClickableLocatorMock>(),
  };
  locator.first.mockReturnValue(locator);
  locator.nth.mockReturnValue(locator);
  return locator;
}

type PageMock = {
  evaluate: ReturnType<typeof jest.fn<(...args: never[]) => Promise<unknown>>>;
  locator: ReturnType<typeof jest.fn<(selector: string) => LocatorMock>>;
  waitForResponse: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
  waitForSelector: ReturnType<typeof jest.fn<() => Promise<unknown>>>;
  url: ReturnType<typeof jest.fn<() => string>>;
};

function createPageMock(currentJobId = '111'): PageMock {
  return {
    evaluate: jest.fn<(...args: never[]) => Promise<unknown>>(),
    locator: jest.fn<(selector: string) => LocatorMock>(() =>
      createLocatorMock(),
    ),
    waitForResponse: jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue(undefined),
    waitForSelector: jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue(undefined),
    // Return a URL that includes the expected currentJobId so the URL
    // verification in clickLinkedInJobSearchResultCard passes.
    url: jest
      .fn<() => string>()
      .mockReturnValue(
        `https://www.linkedin.com/jobs/search?currentJobId=${currentJobId}`,
      ),
  };
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
  it('always clicks by index within ul.jobs-search__results-list, regardless of jobId', async () => {
    const page = createPageMock();
    const card = sampleCards[0]!; // card with a known jobId

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    // modal dismissal uses evaluate; then a single index-scoped locator click
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledWith(
      'ul.jobs-search__results-list > li',
    );
    const locatorMock = page.locator.mock.results[0]?.value as LocatorMock;
    expect(locatorMock.nth).toHaveBeenCalledWith(0);
    expect(page.waitForResponse).toHaveBeenCalledTimes(1);
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
    page.evaluate.mockImplementationOnce(async () => sampleCards);
    page.evaluate.mockImplementation(async () => sampleExtracted);

    const results = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([
      { detailUrl: sampleCards[0]!.detailUrl, extracted: sampleExtracted },
      { detailUrl: sampleCards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(page.locator).toHaveBeenCalledTimes(2);
    expect(page.waitForResponse).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array when no cards are found', async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue([]);

    const results = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([]);
    expect(page.locator).not.toHaveBeenCalled();
  });
});
