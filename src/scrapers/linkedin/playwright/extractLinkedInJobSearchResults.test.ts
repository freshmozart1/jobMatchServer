import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { Page } from "playwright";
import type { ExtractedLinkedInJobPage } from "#types";
import {
  clickLinkedInJobSearchResultCard,
  extractLinkedInJobDetailPane,
  extractLinkedInJobSearchResults,
  listLinkedInJobSearchResultCards,
  type LinkedInJobSearchResultCard,
} from "./extractLinkedInJobSearchResults.js";

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
  return Object.assign(new Error("Timeout 5000ms exceeded"), {
    name: "TimeoutError",
  });
}

type ResponsePredicate = (response: ResponseLike) => boolean;

type PageMock = {
  evaluate: ReturnType<typeof jest.fn<(...args: never[]) => Promise<unknown>>>;
  locator: ReturnType<typeof jest.fn<(selector: string) => LocatorMock>>;
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
};

function createPageMock(): PageMock {
  return {
    evaluate: jest.fn<(...args: never[]) => Promise<unknown>>(),
    locator: jest.fn<(selector: string) => LocatorMock>(() =>
      createLocatorMock(),
    ),
    waitForResponse: jest
      .fn<
        (
          predicate: ResponsePredicate,
          options?: { timeout?: number },
        ) => Promise<ResponseLike>
      >()
      .mockResolvedValue(jobPostingResponse("111")),
    waitForSelector: jest
      .fn<
        (
          selector: string,
          options?: { state?: string; timeout?: number },
        ) => Promise<unknown>
      >()
      .mockResolvedValue(undefined),
  };
}

const sampleCards: LinkedInJobSearchResultCard[] = [
  { jobId: "111", detailUrl: "https://www.linkedin.com/jobs/view/111/" },
  { jobId: null, detailUrl: "https://www.linkedin.com/jobs/view/222/" },
];

const sampleExtracted: ExtractedLinkedInJobPage = {
  title: "Software Engineer",
  company: "Acme Corp",
  location: "Berlin, Germany",
  descriptionText: "A great job.",
  postedAt: "1 day ago",
  tags: ["Full-time"],
  companyPageUrl: "https://www.linkedin.com/company/acme-corp/",
};

beforeEach(() => {
  // Card skips, null-jobId cards and page aborts warn by design; keep test output clean.
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("listLinkedInJobSearchResultCards", () => {
  it("returns whatever the in-page evaluation resolves with", async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(sampleCards);

    const result = await listLinkedInJobSearchResultCards(
      page as unknown as Page,
    );

    expect(result).toEqual(sampleCards);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });
});

describe("clickLinkedInJobSearchResultCard", () => {
  it("always clicks by index within ul.jobs-search__results-list, regardless of jobId", async () => {
    const page = createPageMock();
    const card = sampleCards[0]!; // card with a known jobId

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    // modal dismissal uses evaluate; then a single index-scoped locator click
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledWith(
      "ul.jobs-search__results-list > li",
    );
    const locatorMock = page.locator.mock.results[0]?.value as LocatorMock;
    expect(locatorMock.nth).toHaveBeenCalledWith(0);
    expect(page.waitForResponse).toHaveBeenCalledTimes(1);
  });

  it("verifies the detail pane renders the clicked job via its job-view link", async () => {
    const page = createPageMock();
    const card = sampleCards[0]!;

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    expect(page.waitForSelector).toHaveBeenCalledWith(
      '.two-pane-serp-page__detail-view a[href*="/jobs/view/"][href*="111"]',
      { state: "visible", timeout: 5_000 },
    );
  });

  it("only accepts jobPosting API responses for the clicked job id", async () => {
    const page = createPageMock();
    const card = sampleCards[0]!;

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0);

    const predicate = page.waitForResponse.mock.calls[0]?.[0];
    expect(predicate).toBeDefined();
    if (!predicate) throw new Error("response predicate was not captured");
    expect(predicate(jobPostingResponse("111"))).toBe(true);
    expect(predicate(jobPostingResponse("999"))).toBe(false);
  });

  it("throws with the response status when the pane does not update and the API was rate-limited", async () => {
    const page = createPageMock();
    page.waitForSelector.mockRejectedValue(timeoutError());
    page.waitForResponse.mockResolvedValue(jobPostingResponse("111", 429));
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/jobPosting API responded 429/);
  });

  it("throws a no-response classification when the pane does not update and no API response was seen", async () => {
    const page = createPageMock();
    page.waitForSelector.mockRejectedValue(timeoutError());
    page.waitForResponse.mockRejectedValue(timeoutError());
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/no jobPosting API response was observed/);
  });

  it("throws even when the API responded ok but the pane never rendered the job", async () => {
    const page = createPageMock();
    page.waitForSelector.mockRejectedValue(timeoutError());
    const card = sampleCards[0]!;

    await expect(
      clickLinkedInJobSearchResultCard(page as unknown as Page, card, 0),
    ).rejects.toThrow(/although the jobPosting API responded 200/);
  });

  it("skips detail-pane verification when the card has no job id", async () => {
    const page = createPageMock();
    const card = sampleCards[1]!; // jobId: null

    await clickLinkedInJobSearchResultCard(page as unknown as Page, card, 1);

    expect(page.waitForSelector).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("no data-entity-urn job id"),
    );
  });
});

describe("extractLinkedInJobDetailPane", () => {
  it("returns whatever the in-page evaluation resolves with", async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue(sampleExtracted);

    const result = await extractLinkedInJobDetailPane(page as unknown as Page);

    expect(result).toEqual(sampleExtracted);
  });
});

describe("extractLinkedInJobSearchResults", () => {
  it("clicks through every listed card and collects its extracted detail pane", async () => {
    const page = createPageMock();
    page.evaluate.mockImplementationOnce(async () => sampleCards);
    page.evaluate.mockImplementation(async () => sampleExtracted);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([
      { detailUrl: sampleCards[0]!.detailUrl, extracted: sampleExtracted },
      { detailUrl: sampleCards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
    expect(page.locator).toHaveBeenCalledTimes(2);
    expect(page.waitForResponse).toHaveBeenCalledTimes(2);
  });

  it("returns an empty result set when no cards are found", async () => {
    const page = createPageMock();
    page.evaluate.mockResolvedValue([]);

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([]);
    expect(aborted).toBe(false);
    expect(page.locator).not.toHaveBeenCalled();
  });

  it("skips a card whose pane never updates and resets the failure streak on the next success", async () => {
    const page = createPageMock();
    const cards: LinkedInJobSearchResultCard[] = [
      { jobId: "111", detailUrl: "https://www.linkedin.com/jobs/view/111/" },
      { jobId: "222", detailUrl: "https://www.linkedin.com/jobs/view/222/" },
    ];
    page.evaluate.mockImplementationOnce(async () => cards);
    page.evaluate.mockImplementation(async () => sampleExtracted);
    // First card's pane never renders its job link; second card succeeds.
    page.waitForSelector.mockRejectedValueOnce(timeoutError());

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([
      { detailUrl: cards[1]!.detailUrl, extracted: sampleExtracted },
    ]);
    expect(aborted).toBe(false);
  });

  it("aborts the page after three consecutive card failures instead of clicking every card", async () => {
    const page = createPageMock();
    const cards: LinkedInJobSearchResultCard[] = ["1", "2", "3", "4", "5"].map(
      (id) => ({
        jobId: id,
        detailUrl: `https://www.linkedin.com/jobs/view/${id}/`,
      }),
    );
    page.evaluate.mockImplementationOnce(async () => cards);
    page.evaluate.mockImplementation(async () => sampleExtracted);
    page.waitForSelector.mockRejectedValue(timeoutError());

    const { results, aborted } = await extractLinkedInJobSearchResults(
      page as unknown as Page,
    );

    expect(results).toEqual([]);
    expect(aborted).toBe(true);
    // Cards 4 and 5 must never be clicked once the abort threshold is hit.
    expect(page.locator).toHaveBeenCalledTimes(3);
  });
});
