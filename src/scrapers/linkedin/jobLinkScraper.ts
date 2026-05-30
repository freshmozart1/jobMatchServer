import puppeteer, { type Browser, type Page } from "puppeteer";

import type { ScrapedAnchor, ScrapeJobLinksResult } from "./types.js";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const OBSERVED_PATTERN_LIMIT = 30;
const SIGN_IN_MODAL_DISMISS_SELECTOR = ".modal__dismiss";
const SIGN_IN_MODAL_TIMEOUT_MS = 3_000;
const SIGN_IN_MODAL_SETTLE_MS = 300;

type InspectedPage = {
    pageText: string;
    anchors: ScrapedAnchor[];
};

export function isSupportedLinkedInJobSearchUrl(searchUrl: string): boolean {
    try {
        const url = new URL(searchUrl);

        return (
            url.protocol === "https:" &&
            isLinkedInHost(url.hostname) &&
            (url.pathname === "/jobs/search" || url.pathname === "/jobs/search/")
        );
    } catch {
        return false;
    }
}

export async function scrapeLinkedInJobLinks(searchUrl: string): Promise<ScrapeJobLinksResult> {
    if (!isSupportedLinkedInJobSearchUrl(searchUrl)) {
        throw new Error("Unsupported LinkedIn job search URL.");
    }

    let browser: Browser | null = null;

    try {
        browser = await puppeteer.launch({
            headless: true,
            defaultViewport: {
                width: 1366,
                height: 900,
            },
            args: ["--disable-dev-shm-usage"],
        });

        const page = await browser.newPage();
        await configurePage(page);

        const response = await page.goto(searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
        });

        await dismissLinkedInSignInModal(page);
        await waitForRenderedContent(page);

        const inspectedPage = await inspectRenderedAnchors(page);
        const jobLinks = extractLinkedInJobLinks(inspectedPage.anchors);
        const isGated = isLikelyLinkedInGate(inspectedPage.pageText);

        return {
            searchUrl,
            finalUrl: page.url(),
            pageTitle: await page.title(),
            httpStatus: response?.status() ?? null,
            jobLinks,
            count: jobLinks.length,
            isGated,
            inspectedAnchorCount: inspectedPage.anchors.length,
            observedLinkPatterns: getObservedLinkPatterns(inspectedPage.anchors),
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function configurePage(page: Page): Promise<void> {
    page.setDefaultNavigationTimeout(DEFAULT_NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(DEFAULT_PAGE_TIMEOUT_MS);

    await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",
    );
}

async function dismissLinkedInSignInModal(page: Page): Promise<boolean> {
    try {
        const dismissButton = await page.waitForSelector(SIGN_IN_MODAL_DISMISS_SELECTOR, {
            timeout: SIGN_IN_MODAL_TIMEOUT_MS,
            visible: true,
        });

        if (!dismissButton) {
            return false;
        }

        await dismissButton.click();
        await delay(SIGN_IN_MODAL_SETTLE_MS);

        return true;
    } catch {
        return false;
    }
}

async function waitForRenderedContent(page: Page): Promise<void> {
    await page.waitForSelector("body", { timeout: DEFAULT_PAGE_TIMEOUT_MS });
    await delay(750);

    for (let scrollAttempt = 0; scrollAttempt < 3; scrollAttempt += 1) {
        await page.evaluate(() => {
            window.scrollBy(0, window.innerHeight);
        });
        await delay(500);
    }

    await page.evaluate(() => {
        window.scrollTo(0, 0);
    });
}

async function inspectRenderedAnchors(page: Page): Promise<InspectedPage> {
    return page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((anchor) => {
            const closestContextElement = anchor.closest("[data-job-id], li, article, div");
            const className = closestContextElement?.className;
            const parentClassNames = typeof className === "string" ? className.split(/\s+/).filter(Boolean).slice(0, 8) : [];
            const text = anchor.textContent?.replace(/\s+/g, " ").trim() ?? "";
            const ariaLabel = anchor.getAttribute("aria-label")?.replace(/\s+/g, " ").trim() || undefined;
            const nearbyText = closestContextElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 500) ?? "";

            return {
                href: anchor.href,
                text,
                ariaLabel,
                parentClassNames,
                nearbyText,
            };
        });

        return {
            pageText: document.body?.innerText ?? "",
            anchors,
        };
    });
}

function extractLinkedInJobLinks(anchors: ScrapedAnchor[]): string[] {
    const jobLinks = anchors.flatMap((anchor) => {
        const jobLink = normalizeLinkedInJobDetailUrl(anchor.href);

        return jobLink ? [jobLink] : [];
    });

    return Array.from(new Set(jobLinks));
}

function normalizeLinkedInJobDetailUrl(href: string): string | null {
    try {
        const url = new URL(href);

        if (!isLinkedInHost(url.hostname)) {
            return null;
        }

        const pathParts = url.pathname.split("/").filter(Boolean);

        if (pathParts.length < 3 || pathParts[0] !== "jobs" || pathParts[1] !== "view") {
            return null;
        }

        const jobIdentifier = pathParts[2];

        if (!jobIdentifier) {
            return null;
        }

        return `https://${url.hostname.toLowerCase()}/jobs/view/${jobIdentifier}/`;
    } catch {
        return null;
    }
}

function isLinkedInHost(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();

    return normalizedHostname === "linkedin.com" || normalizedHostname.endsWith(".linkedin.com");
}

function isLikelyLinkedInGate(pageText: string): boolean {
    const normalizedPageText = pageText.toLowerCase();

    return (
        normalizedPageText.includes("sign in to view more jobs") ||
        (normalizedPageText.includes("sign in with email") && normalizedPageText.includes("new to linkedin"))
    );
}

function getObservedLinkPatterns(anchors: ScrapedAnchor[]): string[] {
    const patterns = new Set<string>();

    for (const anchor of anchors) {
        const pattern = getLinkPattern(anchor.href);

        if (pattern) {
            patterns.add(pattern);
        }
    }

    return Array.from(patterns).sort().slice(0, OBSERVED_PATTERN_LIMIT);
}

function getLinkPattern(href: string): string | null {
    try {
        const url = new URL(href);
        const pathname = url.pathname.replace(/\d{4,}/g, ":id");

        return `${url.hostname}${pathname}`;
    } catch {
        return null;
    }
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
