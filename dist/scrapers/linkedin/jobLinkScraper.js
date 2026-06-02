import {} from "puppeteer";
import waitForLinkedInPage from "./waitForLinkedInPage.js";
const LINKEDIN_JOB_SEARCH_URL = "https://www.linkedin.com/jobs/search";
export async function scrapeLinkedInJobLinks(request, response) {
    const searchParams = getLinkedInJobLinkSearchParamsFromBody(request.body);
    if (!searchParams) {
        response.status(400).json({
            error: "Request body must include keywords as a non-empty string or non-empty string array, location as a non-empty string, and distance as a positive integer.",
        });
        return;
    }
    const keywordSearchUrls = searchParams.keywords.map((keyword) => ({
        keyword,
        searchUrl: buildLinkedInJobSearchUrl(keyword, searchParams.location, searchParams.distance),
    }));
    for (const keywordSearchUrl of keywordSearchUrls) {
        if (!isSupportedLinkedInUrl(keywordSearchUrl.searchUrl)) {
            response.status(422).json({ error: "Only LinkedIn jobs search URLs are supported." });
            return;
        }
    }
    try {
        const jobLinksByKeyword = Object.create(null);
        for (const keywordSearchUrl of keywordSearchUrls) {
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
        response.status(getScraperErrorStatus(error)).json({
            error: "Failed to scrape LinkedIn job links.",
            message: getErrorMessage(error),
        });
    }
}
export function getScraperErrorStatus(error) {
    if (error instanceof Error && error.message.toLowerCase().includes("timeout")) {
        return 504;
    }
    return 502;
}
export function getErrorMessage(error) {
    return error instanceof Error ? error.message : "Unknown scraper error.";
}
export function isSupportedLinkedInUrl(searchUrl) {
    try {
        const url = new URL(searchUrl);
        return (url.protocol === "https:" &&
            isLinkedInHost(url.hostname) &&
            (url.pathname === "/jobs/search" || url.pathname === "/jobs/search/"));
    }
    catch {
        return false;
    }
}
function getLinkedInJobLinkSearchParamsFromBody(body) {
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
function isLinkedInHost(hostname) {
    const normalizedHostname = hostname.toLowerCase();
    return normalizedHostname === "linkedin.com" || normalizedHostname.endsWith(".linkedin.com");
}
//# sourceMappingURL=jobLinkScraper.js.map