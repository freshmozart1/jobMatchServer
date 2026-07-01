import {
  chromium,
  type Browser,
  type BrowserServer,
  type Page,
} from 'playwright';
import {
  closeTrackedBrowserServer,
  trackBrowserServer,
} from '#utils/trackedPlaywrightBrowsers.js';

export const LINKEDIN_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const SIGN_IN_MODAL_DISMISS_SELECTOR = '.modal__dismiss';
const SIGN_IN_MODAL_TIMEOUT_MS = 5_000;
const SIGN_IN_MODAL_SETTLE_MS = 300;
const LINKEDIN_SEE_MORE_JOB_POSTINGS_PATH =
  '/jobs-guest/jobs/api/seeMoreJobPostings/search';
const LAZY_LOAD_RESPONSE_TIMEOUT_MS = 5_000;
const LAZY_LOAD_SCROLL_SETTLE_MS = 300;
const LAZY_LOAD_MAX_SCROLL_ATTEMPTS = 80;
const SCROLL_BOTTOM_TOLERANCE_PX = 32;

type LinkedInLazyLoadResponse = {
  url(): string;
  status(): number;
  request(): {
    method(): string;
  };
};

type LinkedInLazyLoadScrollOptions = {
  maxScrollAttempts?: number;
  responseTimeoutMs?: number;
  scrollSettleMs?: number;
};

export default async function waitForLinkedInPage(
  url: string,
): Promise<{ browser: Browser; browserServer: BrowserServer; page: Page }> {
  // Launched via launchServer()+connect() (rather than chromium.launch()) so the
  // spawned Chromium process can be force-killed through BrowserServer.kill() if
  // browserServer.close() ever hangs — Browser (from a plain launch()) exposes no
  // such handle on its underlying OS process.
  const browserServer = await chromium.launchServer({ headless: true });
  trackBrowserServer(browserServer);

  try {
    const browser = await chromium.connect(browserServer.wsEndpoint());
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

    await dismissLinkedInSignInModalIfPresent(page);

    await new Promise((resolve) => setTimeout(resolve, 750));

    await scrollLinkedInLazyLoadedJobsUntilComplete(page);

    return { browser, browserServer, page };
  } catch (error) {
    await closeTrackedBrowserServer(browserServer);
    throw error;
  }
}

async function dismissLinkedInSignInModalIfPresent(page: Page): Promise<void> {
  // Wait until at least one dismiss button appears in the DOM, then bail if
  // none show up (modal is optional — page may load without one).
  const hasModal = await page
    .waitForSelector(SIGN_IN_MODAL_DISMISS_SELECTOR, {
      timeout: SIGN_IN_MODAL_TIMEOUT_MS,
      state: 'attached',
    })
    .then(() => true)
    .catch((error: unknown) => {
      if (isOptionalSignInModalWaitError(error)) return false;
      throw error;
    });

  if (!hasModal) return;

  // Use a direct JS click and DOM removal instead of elementHandle.click().
  // The modal overlay carries pointer-events:none on its container, which causes
  // Playwright's actionability check for pointer events to fail even though the
  // dismiss button is visually present and interactable via JS.
  await page.evaluate((dismissSel) => {
    document
      .querySelectorAll<HTMLElement>(dismissSel)
      .forEach((btn) => btn.click());
    document.querySelectorAll('.modal__overlay').forEach((el) => el.remove());
  }, SIGN_IN_MODAL_DISMISS_SELECTOR);

  await new Promise((resolve) => setTimeout(resolve, SIGN_IN_MODAL_SETTLE_MS));
}

export async function scrollLinkedInLazyLoadedJobsUntilComplete(
  page: Page,
  options: LinkedInLazyLoadScrollOptions = {},
): Promise<void> {
  const maxScrollAttempts =
    options.maxScrollAttempts ?? LAZY_LOAD_MAX_SCROLL_ATTEMPTS;
  const responseTimeoutMs =
    options.responseTimeoutMs ?? LAZY_LOAD_RESPONSE_TIMEOUT_MS;
  const scrollSettleMs = options.scrollSettleMs ?? LAZY_LOAD_SCROLL_SETTLE_MS;

  for (
    let scrollAttempt = 0;
    scrollAttempt < maxScrollAttempts;
    scrollAttempt += 1
  ) {
    // Attach the rejection handler synchronously, before the await below.
    // The timeout timer starts the moment waitForResponse is called, so if the
    // handler were only wired up after `await scrollToPageBottom(page)` the
    // timeout could reject during that gap with no listener attached, surfacing
    // as an unhandled rejection that crashes the process under Node's default policy.
    const responsePromise = page
      .waitForResponse(isLinkedInSeeMoreJobPostingsResponse, {
        timeout: responseTimeoutMs,
      })
      .catch((error: unknown) => {
        if (isResponseWaitTimeoutError(error)) {
          return null;
        }

        throw error;
      });

    const scrollState = await scrollToPageBottom(page);
    const response = await responsePromise;

    if (!response) {
      console.debug(
        `No LinkedIn lazy-load request detected after bottom scroll, scrollAttempt: ${scrollAttempt}, distanceToBottom: ${scrollState.distanceToBottom}`,
      );
      return;
    }

    assertSuccessfulLinkedInSeeMoreJobPostingsResponse(response);

    console.debug(
      `LinkedIn lazy-load response received, scrollAttempt: ${scrollAttempt}, status: ${response.status()}`,
    );

    if (scrollSettleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, scrollSettleMs));
    }
  }

  throw new Error(
    `Max LinkedIn lazy-load scroll attempts reached: ${maxScrollAttempts}`,
  );
}

export function isLinkedInSeeMoreJobPostingsResponse(
  response: LinkedInLazyLoadResponse,
): boolean {
  try {
    const url = new URL(response.url());

    return (
      response.request().method() === 'GET' &&
      url.pathname === LINKEDIN_SEE_MORE_JOB_POSTINGS_PATH
    );
  } catch {
    return false;
  }
}

async function scrollToPageBottom(
  page: Page,
): Promise<{ distanceToBottom: number }> {
  return page.evaluate((bottomTolerancePx) => {
    const scrollElement = document.scrollingElement ?? document.documentElement;

    window.scrollTo(0, scrollElement.scrollHeight);

    const distanceToBottom = Math.max(
      0,
      scrollElement.scrollHeight - window.scrollY - window.innerHeight,
    );

    return {
      distanceToBottom:
        distanceToBottom <= bottomTolerancePx ? 0 : distanceToBottom,
    };
  }, SCROLL_BOTTOM_TOLERANCE_PX);
}

function assertSuccessfulLinkedInSeeMoreJobPostingsResponse(
  response: LinkedInLazyLoadResponse,
): void {
  const status = response.status();

  if (status >= 200 && status < 300) {
    return;
  }

  throw new Error(
    `LinkedIn lazy-load request failed with status ${status}: ${response.url()}`,
  );
}

function isResponseWaitTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.message.includes('Timeout') ||
      error.message.includes('waiting for response'))
  );
}

function isOptionalSignInModalWaitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      error.message.includes(SIGN_IN_MODAL_DISMISS_SELECTOR))
  );
}
