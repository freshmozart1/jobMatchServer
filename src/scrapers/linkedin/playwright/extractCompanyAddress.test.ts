import { describe, expect, it, jest } from '@jest/globals';

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
  newContext: ReturnType<typeof jest.fn<() => Promise<ContextMock>>>;
};

type BrowserServerMock = {
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
  kill: ReturnType<typeof jest.fn<() => Promise<void>>>;
  wsEndpoint: ReturnType<typeof jest.fn<() => string>>;
};

const mockLaunchTrackedBrowserServer =
  jest.fn<
    () => Promise<{ browserServer: BrowserServerMock; browser: BrowserMock }>
  >();

jest.unstable_mockModule('#utils/launchTrackedBrowserServer.js', () => ({
  launchTrackedBrowserServer: mockLaunchTrackedBrowserServer,
}));

const { extractCompanyAddress } = await import('./extractCompanyAddress.js');

function createPageMock(
  paragraphs: string[] | null = ['Musterstraße 42', 'Berlin, 10115, DE'],
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
    newContext: jest
      .fn<() => Promise<ContextMock>>()
      .mockResolvedValue(context),
  };
}

function createBrowserServerMock(): BrowserServerMock {
  return {
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    kill: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    wsEndpoint: jest.fn<() => string>().mockReturnValue('ws://fake'),
  };
}

describe('extractCompanyAddress', () => {
  it('returns the parsed address from the company page', async () => {
    const browserServer = createBrowserServerMock();
    mockLaunchTrackedBrowserServer.mockResolvedValue({
      browserServer,
      browser: createBrowserMock(),
    });

    const address = await extractCompanyAddress(
      'https://www.linkedin.com/company/acme-corp/',
    );

    expect(address).toEqual({
      streetAddress: 'Musterstraße 42',
      city: 'Berlin',
      postalCode: '10115',
      countryCode: 'DE',
    });
    expect(browserServer.close).toHaveBeenCalledTimes(1);
  });

  it('strips query params before navigating', async () => {
    const page = createPageMock();
    const browserServer = createBrowserServerMock();
    mockLaunchTrackedBrowserServer.mockResolvedValue({
      browserServer,
      browser: createBrowserMock(page),
    });

    await extractCompanyAddress(
      'https://www.linkedin.com/company/acme-corp/?trk=guest',
    );

    expect(page.goto).toHaveBeenCalledWith(
      'https://www.linkedin.com/company/acme-corp/',
      expect.any(Object),
    );
  });

  it('throws and still closes the browser server when no address paragraphs are found', async () => {
    const browserServer = createBrowserServerMock();
    mockLaunchTrackedBrowserServer.mockResolvedValue({
      browserServer,
      browser: createBrowserMock(createPageMock(null)),
    });

    await expect(
      extractCompanyAddress('https://www.linkedin.com/company/acme-corp/'),
    ).rejects.toThrow('Could not extract company address');
    expect(browserServer.close).toHaveBeenCalledTimes(1);
  });
});
