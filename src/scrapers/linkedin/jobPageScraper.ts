import puppeteer, { type Browser, type Page } from "puppeteer";

import type { ScrapedJob } from "./types.js";

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_PAGE_TIMEOUT_MS = 15_000;
const SIGN_IN_MODAL_DISMISS_SELECTOR = ".modal__dismiss";
const SIGN_IN_MODAL_TIMEOUT_MS = 3_000;
const SIGN_IN_MODAL_SETTLE_MS = 300;

type ExtractedLinkedInJobPage = {
    title: string | null;
    company: string | null;
    location: string | null;
    descriptionText: string | null;
    postedAt: string | null;
    tags: string[];
};

export function isSupportedLinkedInJobPageUrl(jobUrl: string): boolean {
    try {
        const url = new URL(jobUrl);

        return url.protocol === "https:" && isLinkedInHost(url.hostname) && getLinkedInJobPathSegment(url) !== null;
    } catch {
        return false;
    }
}

export async function scrapeLinkedInJobPage(jobUrl: string): Promise<ScrapedJob> {
    if (!isSupportedLinkedInJobPageUrl(jobUrl)) {
        throw new Error("Unsupported LinkedIn job page URL.");
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

        await page.goto(jobUrl, {
            waitUntil: "domcontentloaded",
            timeout: DEFAULT_NAVIGATION_TIMEOUT_MS,
        });

        await dismissLinkedInSignInModal(page);
        await waitForRenderedContent(page);

        const extractedJobPage = await extractLinkedInJobPage(page);
        const pageTitle = await page.title();
        const canonicalUrl = normalizeLinkedInJobPageUrl(page.url()) ?? normalizeLinkedInJobPageUrl(jobUrl);

        if (!canonicalUrl) {
            throw new Error("Could not normalize LinkedIn job page URL.");
        }

        const canonicalUrlObject = new URL(canonicalUrl);
        const sourceJobId = extractLinkedInJobId(canonicalUrl);
        const title = coalesceText(extractedJobPage.title, getTitleFromPageTitle(pageTitle));
        const company = coalesceText(extractedJobPage.company, getCompanyFromPageTitle(pageTitle));
        const descriptionText = normalizeDescription(extractedJobPage.descriptionText);

        return {
            sourceHostname: canonicalUrlObject.hostname,
            ...(sourceJobId ? { sourceJobId } : {}),
            sourceUrl: canonicalUrl,
            title,
            company,
            ...(extractedJobPage.location ? { location: extractedJobPage.location } : {}),
            ...(descriptionText ? { descriptionText } : {}),
            ...(extractedJobPage.postedAt ? { postedAt: extractedJobPage.postedAt } : {}),
            scrapedAt: new Date().toISOString(),
            ...(extractedJobPage.tags.length > 0 ? { tags: extractedJobPage.tags } : {}),
            duplicateKey: sourceJobId ? `linkedin:${sourceJobId}` : canonicalUrl,
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
}

async function extractLinkedInJobPage(page: Page): Promise<ExtractedLinkedInJobPage> {
    return page.evaluate(() => {
        type JsonRecord = Record<string, unknown>;

        const titleSelectors = [
            "h1.top-card-layout__title",
            ".top-card-layout__title",
            ".job-details-jobs-unified-top-card__job-title h1",
            "h1",
        ];
        const companySelectors = [
            "a.topcard__org-name-link",
            ".topcard__org-name-link",
            ".topcard__flavor-row .topcard__flavor:first-child",
            ".base-card__subtitle",
        ];
        const locationSelectors = [
            ".topcard__flavor--bullet",
            ".job-search-card__location",
            ".jobs-unified-top-card__bullet",
        ];
        const descriptionSelectors = [
            ".show-more-less-html__markup",
            ".description__text",
            "section.description",
            ".jobs-description__content",
            ".jobs-box__html-content",
        ];
        const postedAtSelectors = [
            "time",
            ".posted-time-ago__text",
            ".topcard__flavor--metadata",
        ];
        const tagSelectors = [
            ".description__job-criteria-text",
            ".job-criteria__text",
            ".jobs-unified-top-card__job-insight",
        ];

        function normalizeText(value: string | null | undefined): string | null {
            const normalizedValue = value?.replace(/\s+/g, " ").trim() ?? "";

            return normalizedValue.length > 0 ? normalizedValue : null;
        }

        function getFirstText(selectors: string[]): string | null {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                const text = normalizeText(element?.textContent);

                if (text) {
                    return text;
                }
            }

            return null;
        }

        function getAllTexts(selectors: string[]): string[] {
            const values = new Set<string>();

            for (const selector of selectors) {
                for (const element of Array.from(document.querySelectorAll(selector))) {
                    const text = normalizeText(element.textContent);

                    if (text) {
                        values.add(text);
                    }
                }
            }

            return Array.from(values);
        }

        function getMetaContent(names: string[]): string | null {
            const metaElements = Array.from(document.querySelectorAll<HTMLMetaElement>("meta"));

            for (const metaElement of metaElements) {
                const metaName = metaElement.getAttribute("name") ?? metaElement.getAttribute("property") ?? "";

                if (names.includes(metaName)) {
                    const content = normalizeText(metaElement.content);

                    if (content) {
                        return content;
                    }
                }
            }

            return null;
        }

        function isRecord(value: unknown): value is JsonRecord {
            return typeof value === "object" && value !== null;
        }

        function getString(value: unknown): string | null {
            return typeof value === "string" ? normalizeText(value) : null;
        }

        function stripHtml(value: string | null): string | null {
            if (!value) {
                return null;
            }

            const template = document.createElement("template");
            template.innerHTML = value;

            return normalizeText(template.content.textContent);
        }

        function getJobPostingJsonLd(): JsonRecord | null {
            const candidates: JsonRecord[] = [];

            function collect(value: unknown): void {
                if (Array.isArray(value)) {
                    for (const item of value) {
                        collect(item);
                    }

                    return;
                }

                if (!isRecord(value)) {
                    return;
                }

                collect(value["@graph"]);

                const typeValue = value["@type"];
                const typeValues = Array.isArray(typeValue) ? typeValue : [typeValue];
                const isJobPosting = typeValues.some(
                    (typeItem) => typeof typeItem === "string" && typeItem.toLowerCase() === "jobposting",
                );

                if (isJobPosting) {
                    candidates.push(value);
                }
            }

            for (const scriptElement of Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'))) {
                try {
                    collect(JSON.parse(scriptElement.textContent ?? ""));
                } catch {
                    continue;
                }
            }

            return candidates[0] ?? null;
        }

        function getHiringOrganizationName(jobPosting: JsonRecord | null): string | null {
            const hiringOrganization = jobPosting?.["hiringOrganization"];
            const organizations = Array.isArray(hiringOrganization) ? hiringOrganization : [hiringOrganization];

            for (const organization of organizations) {
                if (isRecord(organization)) {
                    const name = getString(organization["name"]);

                    if (name) {
                        return name;
                    }
                }
            }

            return null;
        }

        function getLocation(jobPosting: JsonRecord | null): string | null {
            const jobLocation = jobPosting?.["jobLocation"];
            const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];

            for (const location of locations) {
                if (!isRecord(location)) {
                    continue;
                }

                const address = isRecord(location["address"]) ? location["address"] : location;
                const parts = [
                    getString(address["addressLocality"]),
                    getString(address["addressRegion"]),
                    getString(address["addressCountry"]),
                ].filter((part): part is string => Boolean(part));

                if (parts.length > 0) {
                    return Array.from(new Set(parts)).join(", ");
                }
            }

            return null;
        }

        function getTags(jobPosting: JsonRecord | null): string[] {
            const values = new Set<string>(getAllTexts(tagSelectors));

            for (const key of ["employmentType", "industry", "occupationalCategory"] as const) {
                const value = jobPosting?.[key];
                const items = Array.isArray(value) ? value : [value];

                for (const item of items) {
                    const text = getString(item);

                    if (text) {
                        values.add(text);
                    }
                }
            }

            return Array.from(values).slice(0, 12);
        }

        const jobPosting = getJobPostingJsonLd();
    const title = getString(jobPosting?.["title"]) ?? getMetaContent(["og:title", "twitter:title"]) ?? getFirstText(titleSelectors);
        const company = getHiringOrganizationName(jobPosting) ?? getFirstText(companySelectors);
        const location = getLocation(jobPosting) ?? getFirstText(locationSelectors);
    const descriptionText = stripHtml(getString(jobPosting?.["description"])) ?? getMetaContent(["description", "og:description"]) ?? getFirstText(descriptionSelectors);
    const postedAt = getString(jobPosting?.["datePosted"]) ?? getFirstText(postedAtSelectors);

        return {
            title,
            company,
            location,
            descriptionText,
            postedAt,
            tags: getTags(jobPosting),
        };
    });
}

function normalizeLinkedInJobPageUrl(jobUrl: string): string | null {
    try {
        const url = new URL(jobUrl);
        const jobPathSegment = getLinkedInJobPathSegment(url);

        if (url.protocol !== "https:" || !isLinkedInHost(url.hostname) || !jobPathSegment) {
            return null;
        }

        return `https://${url.hostname.toLowerCase()}/jobs/view/${jobPathSegment}/`;
    } catch {
        return null;
    }
}

function getLinkedInJobPathSegment(url: URL): string | null {
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (pathParts.length < 3 || pathParts[0] !== "jobs" || pathParts[1] !== "view") {
        return null;
    }

    return pathParts[2] || null;
}

function extractLinkedInJobId(jobUrl: string): string | null {
    try {
        const url = new URL(jobUrl);
        const jobPathSegment = getLinkedInJobPathSegment(url);
        const jobIdMatch = jobPathSegment?.match(/(\d{6,})$/);

        return jobIdMatch?.[1] ?? null;
    } catch {
        return null;
    }
}

function isLinkedInHost(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();

    return normalizedHostname === "linkedin.com" || normalizedHostname.endsWith(".linkedin.com");
}

function coalesceText(...values: Array<string | null | undefined>): string {
    for (const value of values) {
        const normalizedValue = normalizeText(value);

        if (normalizedValue) {
            return normalizedValue;
        }
    }

    return "";
}

function normalizeDescription(value: string | null): string | null {
    const normalizedValue = normalizeText(value);

    if (!normalizedValue || isModalOrLegalText(normalizedValue)) {
        return null;
    }

    return normalizedValue;
}

function normalizeText(value: string | null | undefined): string | null {
    const normalizedValue = value?.replace(/\s+/g, " ").trim() ?? "";

    return normalizedValue.length > 0 ? normalizedValue : null;
}

function getTitleFromPageTitle(pageTitle: string): string | null {
    const normalizedPageTitle = normalizeText(pageTitle);

    if (!normalizedPageTitle) {
        return null;
    }

    const titleWithoutLinkedIn = normalizedPageTitle.replace(/\s+\|\s+LinkedIn$/i, "");
    const titleMatch = titleWithoutLinkedIn.match(/^(.+?)\s+(?:at|bei)\s+.+$/i);

    return normalizeText(titleMatch?.[1] ?? titleWithoutLinkedIn);
}

function getCompanyFromPageTitle(pageTitle: string): string | null {
    const normalizedPageTitle = normalizeText(pageTitle);
    const companyMatch = normalizedPageTitle?.match(/\s+(?:at|bei)\s+(.+?)(?:\s+\|\s+LinkedIn)?$/i);

    return normalizeText(companyMatch?.[1]);
}

function isModalOrLegalText(value: string): boolean {
    const normalizedValue = value.toLowerCase();

    return (
        normalizedValue.includes("einloggen") && normalizedValue.includes("linkedin") && normalizedValue.includes("mitglied werden")
    ) || (
        normalizedValue.includes("sign in") && normalizedValue.includes("linkedin") && normalizedValue.includes("join now")
    );
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}