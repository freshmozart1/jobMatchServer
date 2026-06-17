import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request } from "express";
import type { ExtractedLinkedInJobPage } from "#types";
import createResponse from "../../testHelpers/createResponse.test.js";
import {
  mockLocalDatabaseModule,
  getCollection,
} from "../../testMockModules/localDatabase.test.js";
import {
  mockMongoDbModule,
  connect,
  close,
  createToArray,
  createFind,
} from "../../testMockModules/mongodb.test.js";

const mockWaitForLinkedInPage =
  jest.fn<() => Promise<{ browser: object; page: object }>>();
const mockCreateJobEmbedding = jest.fn<() => Promise<number[]>>();
const toArray = createToArray<{ embedding: number[] }>();
const find = createFind<{ embedding: number[] }>();

jest.unstable_mockModule("./waitForLinkedInPage.js", () => ({
  default: mockWaitForLinkedInPage,
}));
jest.unstable_mockModule("../../embeddings/jobEmbedding.js", () => ({
  createJobEmbedding: mockCreateJobEmbedding,
}));

mockMongoDbModule();
mockLocalDatabaseModule();

const {
  scrapeLinkedInJobPage,
  getUrlFromBody,
  parseCompanyAddress,
  resetLikedEmbeddingsCache,
} = await import("./jobPageScraper.js");

type CompanyPageMock = {
  waitForSelector: ReturnType<typeof jest.fn<() => Promise<void>>>;
  evaluate: ReturnType<typeof jest.fn<() => Promise<string[] | null>>>;
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
};

type TargetMock = {
  asPage: ReturnType<typeof jest.fn<() => Promise<CompanyPageMock | null>>>;
  opener: ReturnType<typeof jest.fn<() => object | null>>;
};

type BrowserMock = {
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
  waitForTarget: ReturnType<typeof jest.fn<() => Promise<TargetMock>>>;
};

type PageMock = {
  click: ReturnType<typeof jest.fn<(selector: string) => Promise<void>>>;
  evaluate: ReturnType<typeof jest.fn<() => Promise<ExtractedLinkedInJobPage>>>;
  title: ReturnType<typeof jest.fn<() => Promise<string>>>;
  url: ReturnType<typeof jest.fn<() => string>>;
  browser: ReturnType<typeof jest.fn<() => BrowserMock>>;
  target: ReturnType<typeof jest.fn<() => object>>;
};

const validLinkedInJobUrl =
  "https://www.linkedin.com/jobs/view/software-engineer-123456789/";

const defaultCompanyAddress = {
  street: "Musterstraße",
  housenumber: 42,
  city: "Berlin",
  postalCode: "10115",
  countryCode: "DE",
};
const defaultCompanyAddressParagraphs = [
  "Musterstraße 42",
  "Berlin, 10115, DE",
];

const defaultExtractedPage: ExtractedLinkedInJobPage = {
  title: "Software Engineer",
  company: "Acme Corp",
  location: "Berlin, Germany",
  descriptionText: "A great job opportunity.",
  postedAt: "2024-01-15",
  tags: ["Full-time"],
  companyPageUrl: "https://www.linkedin.com/company/acme-corp/",
};

function createCompanyPageMock(
  paragraphs: string[] | null = defaultCompanyAddressParagraphs,
): CompanyPageMock {
  return {
    waitForSelector: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    evaluate: jest
      .fn<() => Promise<string[] | null>>()
      .mockResolvedValue(paragraphs),
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function createTargetMock(
  companyPage: CompanyPageMock = createCompanyPageMock(),
): TargetMock {
  return {
    asPage: jest
      .fn<() => Promise<CompanyPageMock | null>>()
      .mockResolvedValue(companyPage),
    opener: jest.fn<() => object | null>().mockReturnValue(null),
  };
}

function createBrowserMock(
  companyPage: CompanyPageMock = createCompanyPageMock(),
): BrowserMock {
  const target = createTargetMock(companyPage);
  return {
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    waitForTarget: jest
      .fn<() => Promise<TargetMock>>()
      .mockResolvedValue(target),
  };
}

function createPageMock({
  url = validLinkedInJobUrl,
  title = "Software Engineer at Acme Corp | LinkedIn",
  extractedPage = defaultExtractedPage,
  browser: browserMock,
}: {
  url?: string;
  title?: string;
  extractedPage?: ExtractedLinkedInJobPage;
  browser?: BrowserMock;
} = {}): PageMock {
  return {
    click: jest
      .fn<(selector: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    evaluate: jest
      .fn<() => Promise<ExtractedLinkedInJobPage>>()
      .mockResolvedValue(extractedPage),
    title: jest.fn<() => Promise<string>>().mockResolvedValue(title),
    url: jest.fn<() => string>().mockReturnValue(url),
    browser: jest
      .fn<() => BrowserMock>()
      .mockReturnValue(browserMock ?? createBrowserMock()),
    target: jest.fn<() => object>().mockReturnValue({}),
  };
}

function createRequest(body: unknown): Request {
  return { body } as Request;
}

describe("getUrlFromBody", () => {
  it("returns null for null body", () => {
    expect(getUrlFromBody(null)).toBeNull();
  });

  it("returns null for undefined body", () => {
    expect(getUrlFromBody(undefined)).toBeNull();
  });

  it("returns null for a string body", () => {
    expect(getUrlFromBody("https://example.com")).toBeNull();
  });

  it("returns null for a number body", () => {
    expect(getUrlFromBody(42)).toBeNull();
  });

  it("returns null for an array body", () => {
    expect(getUrlFromBody(["https://example.com"])).toBeNull();
  });

  it("returns null when the body has no url property", () => {
    expect(getUrlFromBody({ href: "https://example.com" })).toBeNull();
  });

  it("returns null when url is not a string", () => {
    expect(getUrlFromBody({ url: 123 })).toBeNull();
    expect(getUrlFromBody({ url: null })).toBeNull();
    expect(getUrlFromBody({ url: true })).toBeNull();
    expect(getUrlFromBody({ url: [] })).toBeNull();
  });

  it("returns null for an empty url string", () => {
    expect(getUrlFromBody({ url: "" })).toBeNull();
  });

  it("returns null for a whitespace-only url string", () => {
    expect(getUrlFromBody({ url: "   " })).toBeNull();
  });

  it("returns null for an invalid URL string", () => {
    expect(getUrlFromBody({ url: "not-a-url" })).toBeNull();
    expect(getUrlFromBody({ url: "://missing-protocol" })).toBeNull();
  });

  it("returns the normalized URL string for a valid URL", () => {
    expect(
      getUrlFromBody({ url: "https://www.linkedin.com/jobs/view/123456789/" }),
    ).toBe("https://www.linkedin.com/jobs/view/123456789/");
  });

  it("trims whitespace from the url before parsing", () => {
    expect(
      getUrlFromBody({
        url: "  https://www.linkedin.com/jobs/view/123456789/  ",
      }),
    ).toBe("https://www.linkedin.com/jobs/view/123456789/");
  });

  it("accepts a body with additional properties", () => {
    expect(
      getUrlFromBody({ url: "https://example.com/", extra: "ignored" }),
    ).toBe("https://example.com/");
  });
});

describe("parseCompanyAddress", () => {
  it("returns the parsed address for valid paragraphs", () => {
    expect(
      parseCompanyAddress(["Musterstraße 42", "Berlin, 10115, DE"]),
    ).toEqual(defaultCompanyAddress);
  });

  it("returns null when the paragraphs array is empty", () => {
    expect(parseCompanyAddress([])).toBeNull();
  });

  it("returns null when the first paragraph does not match the expected format", () => {
    expect(
      parseCompanyAddress(["NoNumberHere", "Berlin, 10115, DE"]),
    ).toBeNull();
  });

  it("returns null when the second paragraph does not have enough comma-separated parts", () => {
    expect(parseCompanyAddress(["Musterstraße 42", "Berlin"])).toBeNull();
  });
});

describe("scrapeLinkedInJobPage", () => {
  let browser: BrowserMock;
  let companyPage: CompanyPageMock;
  let page: PageMock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetLikedEmbeddingsCache();

    companyPage = createCompanyPageMock();
    browser = createBrowserMock(companyPage);
    page = createPageMock({ browser });

    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    mockCreateJobEmbedding.mockResolvedValue([1, 0, 0]);
    connect.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
    toArray.mockResolvedValue([]);
    find.mockReturnValue({ toArray: toArray });
    getCollection.mockReturnValue({ find: find });
  });

  it("responds 400 when the body has no url", async () => {
    const { response, status, json } = createResponse();

    await scrapeLinkedInJobPage(createRequest({}), response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      message: "Failed to scrape job page.",
      error: "Request body must include a valid string url.",
    });
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it("responds 400 when the body is null", async () => {
    const { response, status } = createResponse();

    await scrapeLinkedInJobPage(createRequest(null), response);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it("responds 400 when the url is not a valid URL string", async () => {
    const { response, status } = createResponse();

    await scrapeLinkedInJobPage(createRequest({ url: "not-a-url" }), response);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it("responds 422 when the url is not a supported LinkedIn job page url", async () => {
    const { response, status, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: "https://example.com/" }),
      response,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      message: "Failed to scrape job page.",
      error: "No job page scraper is registered for this URL.",
    });
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it("responds 422 for a LinkedIn URL that is not a job page", async () => {
    const { response, status } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: "https://www.linkedin.com/jobs/search/" }),
      response,
    );

    expect(status).toHaveBeenCalledWith(422);
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it("responds 200 with the scraped job data on success", async () => {
    const { response, status, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(status).toHaveBeenCalledWith(200);
    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData).toMatchObject({
      sourceHostname: "www.linkedin.com",
      sourceJobId: "123456789",
      sourceUrl: validLinkedInJobUrl,
      title: "Software Engineer",
      company: "Acme Corp",
      location: "Berlin, Germany",
      descriptionText: "A great job opportunity.",
      postedAt: "2024-01-15",
      tags: ["Full-time"],
      duplicateKey: "linkedin:123456789",
      embedding: [1, 0, 0],
      companyAddress: defaultCompanyAddress,
    });
  });

  it("includes a valid ISO scrapedAt timestamp", async () => {
    const { response, json } = createResponse();
    const before = new Date().toISOString();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const after = new Date().toISOString();
    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof jobData["scrapedAt"]).toBe("string");
    expect((jobData["scrapedAt"] as string) >= before).toBe(true);
    expect((jobData["scrapedAt"] as string) <= after).toBe(true);
  });

  it("closes the browser after a successful scrape", async () => {
    const { response } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes the MongoDB client after a successful scrape", async () => {
    const { response } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when page evaluation throws", async () => {
    page.evaluate.mockRejectedValue(new Error("Evaluation failed"));
    const { response } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes the MongoDB client even when a MongoDB error is thrown", async () => {
    toArray.mockRejectedValue(new Error("MongoDB read failed"));
    const { response } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("responds 504 when a timeout error is thrown", async () => {
    mockWaitForLinkedInPage.mockRejectedValue(
      new Error("Navigation timeout exceeded"),
    );
    const { response, status } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(status).toHaveBeenCalledWith(504);
  });

  it("responds 502 when a non-timeout error is thrown", async () => {
    mockWaitForLinkedInPage.mockRejectedValue(new Error("Connection refused"));
    const { response, status, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({
      message: "Failed to scrape job page.",
      error: "Connection refused",
    });
  });

  it("omits cosineSimilarity when no liked jobs exist", async () => {
    toArray.mockResolvedValue([]);
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("cosineSimilarity" in jobData).toBe(false);
  });

  it("includes cosineSimilarity when liked jobs exist", async () => {
    toArray.mockResolvedValue([{ embedding: [1, 0, 0] }]);
    mockCreateJobEmbedding.mockResolvedValue([1, 0, 0]);
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof jobData["cosineSimilarity"]).toBe("number");
    expect(jobData["cosineSimilarity"]).toBeCloseTo(1, 5);
  });

  it("uses the page url for canonical URL when it is a valid LinkedIn job url", async () => {
    page = createPageMock({
      url: "https://www.linkedin.com/jobs/view/different-job-999888777/",
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData["sourceUrl"]).toBe(
      "https://www.linkedin.com/jobs/view/different-job-999888777/",
    );
    expect(jobData["sourceJobId"]).toBe("999888777");
  });

  it("falls back to the request url for canonical URL when the page url cannot be normalized", async () => {
    page = createPageMock({ url: "https://www.linkedin.com/authwall" });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData["sourceUrl"]).toBe(validLinkedInJobUrl);
  });

  it("omits tags when the extracted tags array is empty", async () => {
    page = createPageMock({
      extractedPage: { ...defaultExtractedPage, tags: [] },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("tags" in jobData).toBe(false);
  });

  it("omits location when the extracted location is null", async () => {
    page = createPageMock({
      extractedPage: { ...defaultExtractedPage, location: null },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("location" in jobData).toBe(false);
  });

  it("omits descriptionText when the extracted description is modal or legal text", async () => {
    const modalText = "Einloggen bei LinkedIn, um Mitglied werden zu können.";
    page = createPageMock({
      extractedPage: { ...defaultExtractedPage, descriptionText: modalText },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("descriptionText" in jobData).toBe(false);
  });

  it("omits descriptionText for English LinkedIn sign-in modal text", async () => {
    const modalText = "Sign in to LinkedIn to Join now and see more jobs.";
    page = createPageMock({
      extractedPage: { ...defaultExtractedPage, descriptionText: modalText },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("descriptionText" in jobData).toBe(false);
  });

  it("strips the LinkedIn suffix from the extracted title", async () => {
    page = createPageMock({
      extractedPage: {
        ...defaultExtractedPage,
        title: "Software Engineer | LinkedIn",
      },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData["title"]).toBe("Software Engineer");
  });

  it("extracts title and company from an English-format page title as fallback", async () => {
    page = createPageMock({
      title: "Senior Developer at Big Corp | LinkedIn",
      extractedPage: { ...defaultExtractedPage, title: null, company: null },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData["title"]).toBe("Senior Developer");
    expect(jobData["company"]).toBe("Big Corp");
  });

  it("extracts title from a German-format page title as fallback", async () => {
    page = createPageMock({
      title: "Acme GmbH sucht Senior Developer in Berlin | LinkedIn",
      extractedPage: { ...defaultExtractedPage, title: null, company: null },
    });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData["title"]).toBe("Senior Developer");
  });

  it("uses the canonical URL as duplicateKey when no job ID can be extracted", async () => {
    const urlWithoutId = "https://www.linkedin.com/jobs/view/senior-developer/";
    page = createPageMock({ url: urlWithoutId });
    mockWaitForLinkedInPage.mockResolvedValue({ browser, page });
    const { response, json } = createResponse();

    await scrapeLinkedInJobPage(createRequest({ url: urlWithoutId }), response);

    const jobData = json.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(jobData["duplicateKey"]).toBe(urlWithoutId);
    expect("sourceJobId" in jobData).toBe(false);
  });

  it("responds 502 when #address-0 is not found on the company page", async () => {
    companyPage.evaluate.mockResolvedValue(null);
    const { response, status } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(status).toHaveBeenCalledWith(502);
  });

  it("closes the company page after extracting the address", async () => {
    const { response } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(companyPage.close).toHaveBeenCalledTimes(1);
  });

  it("closes the company page even when its evaluation throws", async () => {
    companyPage.evaluate.mockRejectedValue(
      new Error("Evaluation failed on company page"),
    );
    const { response } = createResponse();

    await scrapeLinkedInJobPage(
      createRequest({ url: validLinkedInJobUrl }),
      response,
    );

    expect(companyPage.close).toHaveBeenCalledTimes(1);
  });
});
