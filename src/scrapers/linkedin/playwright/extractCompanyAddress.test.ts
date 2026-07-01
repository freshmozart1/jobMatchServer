import { describe, expect, it, jest } from "@jest/globals";

type PageMock = {
  goto: ReturnType<
    typeof jest.fn<(url: string, options?: object) => Promise<null>>
  >;
  waitForSelector: ReturnType<typeof jest.fn<() => Promise<void>>>;
  evaluate: ReturnType<typeof jest.fn<() => Promise<string[] | null>>>;
};

type ContextMock = {
  newPage: ReturnType<typeof jest.fn<() => Promise<PageMock>>>;
};

type BrowserMock = {
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
  newContext: ReturnType<typeof jest.fn<() => Promise<ContextMock>>>;
};

const mockChromiumLaunch = jest.fn<() => Promise<BrowserMock>>();

jest.unstable_mockModule("playwright", () => ({
  chromium: { launch: mockChromiumLaunch },
}));

const { extractCompanyAddress } = await import("./extractCompanyAddress.js");

function createPageMock(
  paragraphs: string[] | null = ["Musterstraße 42", "Berlin, 10115, DE"],
): PageMock {
  return {
    goto: jest
      .fn<(url: string, options?: object) => Promise<null>>()
      .mockResolvedValue(null),
    waitForSelector: jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined),
    evaluate: jest
      .fn<() => Promise<string[] | null>>()
      .mockResolvedValue(paragraphs),
  };
}

function createBrowserMock(page: PageMock = createPageMock()): BrowserMock {
  const context: ContextMock = {
    newPage: jest.fn<() => Promise<PageMock>>().mockResolvedValue(page),
  };
  return {
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    newContext: jest
      .fn<() => Promise<ContextMock>>()
      .mockResolvedValue(context),
  };
}

describe("extractCompanyAddress", () => {
  it("returns the parsed address from the company page", async () => {
    const browser = createBrowserMock();
    mockChromiumLaunch.mockResolvedValue(browser);

    const address = await extractCompanyAddress(
      "https://www.linkedin.com/company/acme-corp/",
    );

    expect(address).toEqual({
      streetAddress: "Musterstraße 42",
      city: "Berlin",
      postalCode: "10115",
      countryCode: "DE",
    });
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("strips query params before navigating", async () => {
    const page = createPageMock();
    const browser = createBrowserMock(page);
    mockChromiumLaunch.mockResolvedValue(browser);

    await extractCompanyAddress(
      "https://www.linkedin.com/company/acme-corp/?trk=guest",
    );

    expect(page.goto).toHaveBeenCalledWith(
      "https://www.linkedin.com/company/acme-corp/",
      expect.any(Object),
    );
  });

  it("throws and still closes the browser when no address paragraphs are found", async () => {
    const browser = createBrowserMock(createPageMock(null));
    mockChromiumLaunch.mockResolvedValue(browser);

    await expect(
      extractCompanyAddress("https://www.linkedin.com/company/acme-corp/"),
    ).rejects.toThrow("Could not extract company address");
    expect(browser.close).toHaveBeenCalledTimes(1);
  });
});
