import type { BrowserServer } from 'playwright';
import { closePlaywrightBrowserServer } from './closePlaywrightBrowser.js';

const trackedBrowserServers = new Set<BrowserServer>();

export function trackBrowserServer(browserServer: BrowserServer): void {
  trackedBrowserServers.add(browserServer);
}

export async function closeTrackedBrowserServer(
  browserServer: BrowserServer,
): Promise<void> {
  try {
    await closePlaywrightBrowserServer(browserServer);
  } finally {
    trackedBrowserServers.delete(browserServer);
  }
}

export async function closeAllTrackedBrowserServers(): Promise<void> {
  await Promise.all(
    Array.from(trackedBrowserServers).map((browserServer) =>
      closeTrackedBrowserServer(browserServer),
    ),
  );
}
