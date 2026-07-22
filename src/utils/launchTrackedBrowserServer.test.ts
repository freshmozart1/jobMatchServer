import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Browser, BrowserServer } from 'playwright';

const mockChromiumLaunchServer =
  jest.fn<(options: { headless: boolean }) => Promise<BrowserServer>>();
const mockChromiumConnect = jest.fn<(wsEndpoint: string) => Promise<Browser>>();
const mockTrackBrowserServer =
  jest.fn<(browserServer: BrowserServer) => void>();

jest.unstable_mockModule('playwright', () => ({
  chromium: {
    launchServer: mockChromiumLaunchServer,
    connect: mockChromiumConnect,
  },
}));
jest.unstable_mockModule('./trackedPlaywrightBrowsers.js', () => ({
  trackBrowserServer: mockTrackBrowserServer,
}));

const { launchTrackedBrowserServer } =
  await import('./launchTrackedBrowserServer.js');

function createBrowserServerMock(): BrowserServer {
  return {
    wsEndpoint: jest.fn<() => string>().mockReturnValue('ws://fake'),
  } as unknown as BrowserServer;
}

describe('launchTrackedBrowserServer', () => {
  const originalPlaywrightHeadless = process.env['PLAYWRIGHT_HEADLESS'];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalPlaywrightHeadless === undefined) {
      delete process.env['PLAYWRIGHT_HEADLESS'];
    } else {
      process.env['PLAYWRIGHT_HEADLESS'] = originalPlaywrightHeadless;
    }
  });

  it('launches a server, tracks it, connects, and returns both', async () => {
    delete process.env['PLAYWRIGHT_HEADLESS'];
    const browserServer = createBrowserServerMock();
    const browser = {} as Browser;
    mockChromiumLaunchServer.mockResolvedValue(browserServer);
    mockChromiumConnect.mockResolvedValue(browser);

    const result = await launchTrackedBrowserServer();

    expect(mockChromiumLaunchServer).toHaveBeenCalledWith({ headless: true });
    expect(mockTrackBrowserServer).toHaveBeenCalledWith(browserServer);
    expect(mockChromiumConnect).toHaveBeenCalledWith('ws://fake');
    expect(result).toEqual({ browserServer, browser });
  });

  it('launches headed when PLAYWRIGHT_HEADLESS is "false"', async () => {
    process.env['PLAYWRIGHT_HEADLESS'] = 'false';
    const browserServer = createBrowserServerMock();
    mockChromiumLaunchServer.mockResolvedValue(browserServer);
    mockChromiumConnect.mockResolvedValue({} as Browser);

    await launchTrackedBrowserServer();

    expect(mockChromiumLaunchServer).toHaveBeenCalledWith({ headless: false });
  });

  it('stays headless for any other PLAYWRIGHT_HEADLESS value', async () => {
    process.env['PLAYWRIGHT_HEADLESS'] = 'nope';
    const browserServer = createBrowserServerMock();
    mockChromiumLaunchServer.mockResolvedValue(browserServer);
    mockChromiumConnect.mockResolvedValue({} as Browser);

    await launchTrackedBrowserServer();

    expect(mockChromiumLaunchServer).toHaveBeenCalledWith({ headless: true });
  });
});
