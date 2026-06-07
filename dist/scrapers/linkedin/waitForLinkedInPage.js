import puppeteer, {} from "puppeteer";
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const SIGN_IN_MODAL_DISMISS_SELECTOR = ".modal__dismiss";
const SIGN_IN_MODAL_TIMEOUT_MS = 5_000;
const SIGN_IN_MODAL_SETTLE_MS = 300;
const LINKEDIN_SEE_MORE_JOB_POSTINGS_PATH = "/jobs-guest/jobs/api/seeMoreJobPostings/search";
const LAZY_LOAD_RESPONSE_TIMEOUT_MS = 5_000;
const LAZY_LOAD_SCROLL_SETTLE_MS = 300;
const LAZY_LOAD_MAX_SCROLL_ATTEMPTS = 80;
const SCROLL_BOTTOM_TOLERANCE_PX = 32;
export default async function waitForLinkedInPage(url) {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: {
            width: 1366,
            height: 900,
        },
        args: ["--disable-dev-shm-usage"],
    });
    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT_MS);
        page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT_MS);
        await page.setUserAgent({
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/124.0.0.0 Safari/537.36",
            platform: "macOS",
        });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: DEFAULT_NAVIGATION_TIMEOUT_MS });
        await dismissLinkedInSignInModalIfPresent(page);
        await page.waitForSelector("body", { timeout: DEFAULT_PAGE_TIMEOUT_MS });
        await new Promise((resolve) => setTimeout(resolve, 750));
        await scrollLinkedInLazyLoadedJobsUntilComplete(page);
        return { browser, page };
    }
    catch (error) {
        await browser.close().catch(() => undefined);
        throw error;
    }
}
async function dismissLinkedInSignInModalIfPresent(page) {
    const dismissButton = await page.waitForSelector(SIGN_IN_MODAL_DISMISS_SELECTOR, {
        timeout: SIGN_IN_MODAL_TIMEOUT_MS,
        visible: true,
    }).catch((error) => {
        if (isOptionalSignInModalWaitError(error)) {
            return null;
        }
        throw error;
    });
    if (!dismissButton) {
        return;
    }
    await dismissButton.click();
    await new Promise((resolve) => setTimeout(resolve, SIGN_IN_MODAL_SETTLE_MS));
}
export async function scrollLinkedInLazyLoadedJobsUntilComplete(page, options = {}) {
    const maxScrollAttempts = options.maxScrollAttempts ?? LAZY_LOAD_MAX_SCROLL_ATTEMPTS;
    const responseTimeoutMs = options.responseTimeoutMs ?? LAZY_LOAD_RESPONSE_TIMEOUT_MS;
    const scrollSettleMs = options.scrollSettleMs ?? LAZY_LOAD_SCROLL_SETTLE_MS;
    for (let scrollAttempt = 0; scrollAttempt < maxScrollAttempts; scrollAttempt += 1) {
        const responsePromise = page.waitForResponse(isLinkedInSeeMoreJobPostingsResponse, {
            timeout: responseTimeoutMs,
        });
        const scrollState = await scrollToPageBottom(page);
        const response = await responsePromise.catch((error) => {
            if (isResponseWaitTimeoutError(error)) {
                return null;
            }
            throw error;
        });
        if (!response) {
            console.debug(`No LinkedIn lazy-load request detected after bottom scroll, scrollAttempt: ${scrollAttempt}, distanceToBottom: ${scrollState.distanceToBottom}`);
            return;
        }
        assertSuccessfulLinkedInSeeMoreJobPostingsResponse(response);
        const start = extractLinkedInLazyLoadStart(response.url());
        console.debug(`LinkedIn lazy-load response received, scrollAttempt: ${scrollAttempt}, status: ${response.status()}, start: ${start ?? "unknown"}`);
        if (scrollSettleMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, scrollSettleMs));
        }
    }
    throw new Error(`Max LinkedIn lazy-load scroll attempts reached: ${maxScrollAttempts}`);
}
export function isLinkedInSeeMoreJobPostingsResponse(response) {
    try {
        const url = new URL(response.url());
        return response.request().method() === "GET" && url.pathname === LINKEDIN_SEE_MORE_JOB_POSTINGS_PATH;
    }
    catch {
        return false;
    }
}
async function scrollToPageBottom(page) {
    return page.evaluate((bottomTolerancePx) => {
        const scrollElement = document.scrollingElement ?? document.documentElement;
        window.scrollTo(0, scrollElement.scrollHeight);
        const distanceToBottom = Math.max(0, scrollElement.scrollHeight - window.scrollY - window.innerHeight);
        return {
            distanceToBottom: distanceToBottom <= bottomTolerancePx ? 0 : distanceToBottom,
        };
    }, SCROLL_BOTTOM_TOLERANCE_PX);
}
function assertSuccessfulLinkedInSeeMoreJobPostingsResponse(response) {
    const status = response.status();
    if (status >= 200 && status < 300) {
        return;
    }
    throw new Error(`LinkedIn lazy-load request failed with status ${status}: ${response.url()}`);
}
function extractLinkedInLazyLoadStart(responseUrl) {
    try {
        return new URL(responseUrl).searchParams.get("start");
    }
    catch {
        return null;
    }
}
function isResponseWaitTimeoutError(error) {
    return (error instanceof Error &&
        (error.name === "TimeoutError" || error.message.includes("Timed out") || error.message.includes("waiting for response")));
}
function isOptionalSignInModalWaitError(error) {
    return (error instanceof Error &&
        (error.name === "TimeoutError" || error.message.includes(`Waiting for selector \`${SIGN_IN_MODAL_DISMISS_SELECTOR}\` failed`)));
}
//# sourceMappingURL=waitForLinkedInPage.js.map