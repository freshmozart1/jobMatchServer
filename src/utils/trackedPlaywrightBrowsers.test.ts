import { describe, expect, it, jest } from '@jest/globals';
import type { BrowserServer } from 'playwright';
import {
  closeAllTrackedBrowserServers,
  closeTrackedBrowserServer,
  trackBrowserServer,
} from './trackedPlaywrightBrowsers.js';

function createFakeBrowserServer(): BrowserServer & {
  close: ReturnType<typeof jest.fn<() => Promise<void>>>;
} {
  const close = jest.fn<() => Promise<void>>(() => Promise.resolve());
  return {
    close,
    kill: jest.fn<() => Promise<void>>(() => Promise.resolve()),
  } as unknown as BrowserServer & { close: typeof close };
}

describe('trackedPlaywrightBrowsers', () => {
  it('closes and untracks a single tracked browser server', async () => {
    const browserServer = createFakeBrowserServer();
    trackBrowserServer(browserServer);

    await closeTrackedBrowserServer(browserServer);

    expect(browserServer.close).toHaveBeenCalledTimes(1);

    // A second close on an already-untracked server must not throw.
    await expect(
      closeTrackedBrowserServer(browserServer),
    ).resolves.toBeUndefined();
  });

  it('closes every tracked browser server and leaves the registry empty', async () => {
    const browserServerA = createFakeBrowserServer();
    const browserServerB = createFakeBrowserServer();
    trackBrowserServer(browserServerA);
    trackBrowserServer(browserServerB);

    await closeAllTrackedBrowserServers();

    expect(browserServerA.close).toHaveBeenCalledTimes(1);
    expect(browserServerB.close).toHaveBeenCalledTimes(1);

    // Nothing left to close, so a second pass must not throw or re-close.
    await expect(closeAllTrackedBrowserServers()).resolves.toBeUndefined();
    expect(browserServerA.close).toHaveBeenCalledTimes(1);
    expect(browserServerB.close).toHaveBeenCalledTimes(1);
  });

  it('does not throw when there is nothing tracked', async () => {
    await expect(closeAllTrackedBrowserServers()).resolves.toBeUndefined();
  });
});
