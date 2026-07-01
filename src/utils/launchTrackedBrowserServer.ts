import { chromium, type Browser, type BrowserServer } from 'playwright';
import { trackBrowserServer } from './trackedPlaywrightBrowsers.js';

// Launched via launchServer()+connect() (rather than chromium.launch()) so the
// spawned Chromium process can be force-killed through BrowserServer.kill() if
// browserServer.close() ever hangs — Browser (from a plain launch()) exposes no
// such handle on its underlying OS process.
export async function launchTrackedBrowserServer(): Promise<{
  browserServer: BrowserServer;
  browser: Browser;
}> {
  const browserServer = await chromium.launchServer({ headless: true });
  trackBrowserServer(browserServer);

  const browser = await chromium.connect(browserServer.wsEndpoint());

  return { browserServer, browser };
}
