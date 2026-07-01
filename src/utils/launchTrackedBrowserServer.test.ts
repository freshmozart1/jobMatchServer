import { describe, expect, it, jest } from '@jest/globals';
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
  it('launches a server, tracks it, connects, and returns both', async () => {
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
});
