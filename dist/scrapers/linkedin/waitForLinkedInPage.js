import puppeteer, {} from "puppeteer";
const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const SIGN_IN_MODAL_DISMISS_SELECTOR = ".modal__dismiss";
const SIGN_IN_MODAL_TIMEOUT_MS = 5_000;
const SIGN_IN_MODAL_SETTLE_MS = 300;
const TIME_POSTED_FILTER_INPUT_ID = "f_TPR-3";
const TIME_POSTED_FILTER_LABEL_SELECTOR = `label[for="${TIME_POSTED_FILTER_INPUT_ID}"]`;
const TIME_POSTED_SCROLL_SETTLE_MS = 300;
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
        await scrollByTimePostedResultCountIfPresent(page);
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
async function scrollByTimePostedResultCountIfPresent(page) {
    const labelText = await page.evaluate(({ inputId, labelSelector }) => {
        const inputElement = document.getElementById(inputId);
        const associatedLabel = inputElement instanceof HTMLInputElement ? inputElement.labels?.[0] ?? null : null;
        const fallbackLabel = document.querySelector(labelSelector);
        return (associatedLabel ?? fallbackLabel)?.textContent?.replace(/\s+/g, " ").trim() || null;
    }, {
        inputId: TIME_POSTED_FILTER_INPUT_ID,
        labelSelector: TIME_POSTED_FILTER_LABEL_SELECTOR,
    });
    if (!labelText) {
        return;
    }
    const resultCount = extractParenthesizedCount(labelText);
    if (resultCount === null) {
        throw new Error(`Could not extract result count from LinkedIn time posted label: ${labelText}`);
    }
    for (let scrollIndex = 0; scrollIndex < resultCount; scrollIndex += 1) {
        await new Promise((resolve) => setTimeout(resolve, TIME_POSTED_SCROLL_SETTLE_MS));
        await page.evaluate(() => window.scrollBy(0, 160));
        console.debug(`Scrolled time posted filter results, scrollIndex: ${scrollIndex}, totalResults: ${resultCount}, scrollProgress: ${((scrollIndex + 1) / resultCount * 100).toFixed(2)}%`);
    }
}
function extractParenthesizedCount(labelText) {
    const countMatch = labelText.match(/\(([\d,]+)\)\s*$/);
    const countText = countMatch?.[1]?.replace(/,/g, "");
    if (!countText) {
        return null;
    }
    const count = Number.parseInt(countText, 10);
    console.debug(`Extracted time posted result count: ${count} from label text: "${labelText}"`);
    return Number.isFinite(count) ? count : null;
}
function isOptionalSignInModalWaitError(error) {
    return (error instanceof Error &&
        (error.name === "TimeoutError" || error.message.includes(`Waiting for selector \`${SIGN_IN_MODAL_DISMISS_SELECTOR}\` failed`)));
}
//# sourceMappingURL=waitForLinkedInPage.js.map