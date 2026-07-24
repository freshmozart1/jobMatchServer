import { type Browser, type BrowserServer, type Page } from 'playwright';
import { launchTrackedBrowserServer } from '#utils/launchTrackedBrowserServer.js';
import { closeTrackedBrowserServer } from '#utils/trackedPlaywrightBrowsers.js';

export const LINKEDIN_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;

// Cookie-consent (on load) and the "sign in to view more jobs" nag (any time
// after) share the same overlay/dismiss-button markup on LinkedIn's guest
// pages, so one generic poll-and-clear routine handles both.
const OVERLAY_SELECTOR = '.modal__overlay';
const OVERLAY_DISMISS_SELECTOR = '.modal__dismiss';
const OVERLAY_POLL_TIMEOUT_MS = 15_000;
const OVERLAY_POLL_INTERVAL_MS = 250;
const OVERLAY_REQUIRED_CONSECUTIVE_CLEAR = 5;
const OVERLAY_SETTLE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function waitForLinkedInPage(
  url: string,
): Promise<{ browser: Browser; browserServer: BrowserServer; page: Page }> {
  const { browserServer, browser } = await launchTrackedBrowserServer();

  try {
    // Use newContext() so that page.context().newPage() works later
    // (e.g. in extractCompanyAddress). browser.newPage() creates a page in a
    // restricted "default context" that disallows additional newPage() calls.
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      userAgent: LINKEDIN_USER_AGENT,
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT_MS);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
    });

    await clearLinkedInOverlays(page);

    return { browser, browserServer, page };
  } catch (error) {
    await closeTrackedBrowserServer(browserServer);
    throw error;
  }
}

export type ClearLinkedInOverlaysOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
  requiredConsecutiveClear?: number;
};

// LinkedIn's guest pages block interaction behind a dismissible modal overlay
// (a cookie-consent banner on load, later a "sign in to view more jobs" nag)
// that can appear asynchronously at any point, not just once at page-load —
// so this polls for a while instead of checking once, only concluding
// "nothing to dismiss" after several consecutive not-found reads. Returns
// whether an overlay was found (and dismissed) at any point during the poll,
// which callers also use as a "was something covering the page just now"
// staleness signal.
//
// Dismissal uses a direct JS click + DOM removal instead of relying on
// Playwright's own actionability-checked click: the overlay carries
// pointer-events:none on its container, which fails that check even though
// the dismiss button is visually present and interactable via JS.
export async function clearLinkedInOverlays(
  page: Page,
  options: ClearLinkedInOverlaysOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? OVERLAY_POLL_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? OVERLAY_POLL_INTERVAL_MS;
  const requiredConsecutiveClear =
    options.requiredConsecutiveClear ?? OVERLAY_REQUIRED_CONSECUTIVE_CLEAR;
  const deadline = Date.now() + timeoutMs;
  let consecutiveClear = 0;
  let dismissedAny = false;

  while (Date.now() < deadline) {
    const foundOverlay = await page.evaluate(
      ({ overlaySel, dismissSel }) => {
        const overlay = document.querySelector(overlaySel);
        if (!overlay) return false;
        document
          .querySelectorAll<HTMLElement>(dismissSel)
          .forEach((btn) => btn.click());
        document.querySelectorAll(overlaySel).forEach((el) => el.remove());
        return true;
      },
      { overlaySel: OVERLAY_SELECTOR, dismissSel: OVERLAY_DISMISS_SELECTOR },
    );

    if (foundOverlay) {
      dismissedAny = true;
      consecutiveClear = 0;
    } else {
      consecutiveClear += 1;
      if (consecutiveClear >= requiredConsecutiveClear) break;
    }

    await sleep(pollIntervalMs);
  }

  if (dismissedAny) {
    await sleep(OVERLAY_SETTLE_MS);
  }

  return dismissedAny;
}
