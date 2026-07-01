import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { BrowserServer } from 'playwright';
import { closePlaywrightBrowserServer } from './closePlaywrightBrowser.js';

function createFakeBrowserServer(options: {
  close: () => Promise<void>;
}): BrowserServer & { kill: ReturnType<typeof jest.fn<() => Promise<void>>> } {
  const kill = jest.fn<() => Promise<void>>(() => Promise.resolve());
  return {
    close: options.close,
    kill,
  } as unknown as BrowserServer & { kill: typeof kill };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('closePlaywrightBrowserServer', () => {
  it('does not kill the process when close() resolves before the timeout', async () => {
    const browserServer = createFakeBrowserServer({
      close: () => Promise.resolve(),
    });

    await closePlaywrightBrowserServer(browserServer, 5_000);

    expect(browserServer.kill).not.toHaveBeenCalled();
  });

  it('kills the process when close() hangs past the timeout', async () => {
    const browserServer = createFakeBrowserServer({
      close: () => new Promise(() => undefined),
    });

    const closePromise = closePlaywrightBrowserServer(browserServer, 5_000);
    await jest.advanceTimersByTimeAsync(5_000);
    await closePromise;

    expect(browserServer.kill).toHaveBeenCalledTimes(1);
  });

  it('kills the process when close() rejects', async () => {
    const browserServer = createFakeBrowserServer({
      close: () => Promise.reject(new Error('close failed')),
    });

    await closePlaywrightBrowserServer(browserServer, 5_000);

    expect(browserServer.kill).toHaveBeenCalledTimes(1);
  });

  it('never throws, even when kill() itself rejects', async () => {
    const browserServer = createFakeBrowserServer({
      close: () => Promise.reject(new Error('close failed')),
    });
    browserServer.kill.mockRejectedValueOnce(new Error('kill failed'));

    await expect(
      closePlaywrightBrowserServer(browserServer, 5_000),
    ).resolves.toBeUndefined();
  });
});
