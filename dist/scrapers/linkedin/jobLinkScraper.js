import waitForLinkedInPage from "./waitForLinkedInPage.js";
import isSupportedLinkedInUrl from "./isSupportedLinkedInUrl.js";
import isLinkedInHost from "./isLinkedInHost.js";
import { createErrorMessage } from "../../errors/createErrorMessage.js";
const LINKEDIN_JOB_SEARCH_URL = "https://www.linkedin.com/jobs/search";
export async function scrapeLinkedInJobLinks(request, response) {
    const searchParams = getLinkedInJobLinkSearchParamsFromBody(request.body);
    const unsupportedUrlError = new Error("Only LinkedIn jobs search URLs are supported.");
    const unsupportedSearchParamsError = new Error("Invalid search parameters. Please ensure keywords is a non-empty string or non-empty string array, location is a non-empty string, and distance is a positive integer.");
    try {
        if (!searchParams)
            throw unsupportedSearchParamsError;
        const jobLinksByKeyword = Object.create(null);
        for (const keywordSearchUrl of searchParams.keywords.map(keyword => {
            const searchUrl = buildLinkedInJobSearchUrl(keyword, searchParams.location, searchParams.distance);
            if (!isSupportedLinkedInUrl(searchUrl, 'jobSearchPage'))
                throw unsupportedUrlError;
            return { keyword, searchUrl };
        })) {
            let browser = null;
            try {
                const { browser: renderedBrowser, page } = await waitForLinkedInPage(keywordSearchUrl.searchUrl);
                browser = renderedBrowser;
                const inspectedPage = await inspectRenderedAnchors(page);
                jobLinksByKeyword[keywordSearchUrl.keyword] = extractLinkedInJobLinks(inspectedPage.anchors);
            }
            finally {
                if (browser) {
                    await browser.close();
                }
            }
        }
        response.status(200).json(jobLinksByKeyword);
    }
    catch (error) {
        createErrorMessage(response, error, "Failed to scrape LinkedIn job links.", getScraperErrorStatus(error));
    }
}
export function getScraperErrorStatus(error) {
    if (error instanceof Error && error.message.toLowerCase().includes("timeout")) {
        return 504;
    }
    return 502;
}
export function getLinkedInJobLinkSearchParamsFromBody(body) {
    if (!body || typeof body !== "object" || !("keywords" in body) || !("location" in body) || !("distance" in body)) {
        return null;
    }
    const keywords = body.keywords;
    const location = body.location;
    const distance = body.distance;
    if (typeof location !== "string") {
        return null;
    }
    const trimmedKeywords = getTrimmedUniqueKeywords(keywords);
    const trimmedLocation = location.trim();
    if (!trimmedKeywords || trimmedLocation.length === 0) {
        return null;
    }
    if (typeof distance !== "number" || !Number.isFinite(distance) || !Number.isInteger(distance) || distance <= 0) {
        return null;
    }
    return {
        keywords: trimmedKeywords,
        location: trimmedLocation,
        distance,
    };
}
function getTrimmedUniqueKeywords(keywords) {
    const keywordValues = typeof keywords === "string" ? [keywords] : keywords;
    if (!Array.isArray(keywordValues) || keywordValues.length === 0) {
        return null;
    }
    const trimmedKeywords = [];
    for (const keywordValue of keywordValues) {
        if (typeof keywordValue !== "string") {
            return null;
        }
        const trimmedKeyword = keywordValue.trim();
        if (trimmedKeyword.length === 0) {
            return null;
        }
        if (!trimmedKeywords.includes(trimmedKeyword)) {
            trimmedKeywords.push(trimmedKeyword);
        }
    }
    return trimmedKeywords;
}
function buildLinkedInJobSearchUrl(keyword, location, distance) {
    const url = new URL(LINKEDIN_JOB_SEARCH_URL);
    const encodedKeywordSpaces = keyword.replace(/\s+/g, "+");
    url.searchParams.set("keywords", encodedKeywordSpaces);
    url.searchParams.set("location", location);
    url.searchParams.set("distance", distance.toString());
    return url.toString() + '&f_TPR=r86400';
}
async function inspectRenderedAnchors(page) {
    return page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll("a[href]")).map((anchor) => {
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
        return { anchors };
    });
}
function extractLinkedInJobLinks(anchors) {
    const jobLinks = anchors.flatMap((anchor) => {
        const jobLink = normalizeLinkedInJobDetailUrl(anchor.href);
        return jobLink ? [jobLink] : [];
    });
    return Array.from(new Set(jobLinks));
}
function normalizeLinkedInJobDetailUrl(href) {
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
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=jobLinkScraper.js.map