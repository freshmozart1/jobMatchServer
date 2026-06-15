import type { Request, Response } from "express";
import type { Browser, Page } from "puppeteer";
import type { ExtractedLinkedInJobPage, StoredScrapedJob } from "#types";
import getLinkedInJobPathSegment from "./getLinkedInJobPathSegment.js";
import { getScraperErrorStatus } from "./jobLinkScraper.js";
import isLinkedInHost from "./isLinkedInHost.js";
import waitForLinkedInPage from "./waitForLinkedInPage.js";
import isSupportedLinkedInUrl from "./isSupportedLinkedInUrl.js";
import { createJobEmbedding } from "../../embeddings/jobEmbedding.js";
import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "#database/database.js";
import calculateCosineSimilarity from "../../embeddings/calculateCosineSimilarity.js";
import { createErrorMessage } from "../../errors/createErrorMessage.js";

export async function scrapeLinkedInJobPage(request: Request, response: Response): Promise<void> {
    const jobUrl = getUrlFromBody(request.body);
    const bodyHasNoUrlError = new Error("Request body must include a valid string url.");
    const unsupportedUrlError = new Error("No job page scraper is registered for this URL.");
    const couldntNormalizeUrlError = new Error("Could not normalize LinkedIn job page URL.");


    if (!connectionStringConfigured(response)) return;

    if (!jobUrl) {
        createErrorMessage(response, bodyHasNoUrlError, "Failed to scrape job page.", 400);
        return;
    }
    if (!isSupportedLinkedInUrl(jobUrl, "jobPage")) {
        createErrorMessage(response, unsupportedUrlError, "Failed to scrape job page.", 422);
        return;
    }

    const client = new MongoClient(MONGODB_CONNECTION!);

    await client.connect();

    let browser: Browser | null = null;

    try {
        const { browser: renderedBrowser, page } = await waitForLinkedInPage(jobUrl);
        browser = renderedBrowser;

        const extractedJobPage = await extractLinkedInJobPage(page);
        const pageTitle = await page.title();
        const normalizedUrl = normalizeLinkedInJobPageUrl(page.url()) ?? normalizeLinkedInJobPageUrl(jobUrl);

        if (!normalizedUrl) throw couldntNormalizeUrlError;

        const normalizedUrlObject = new URL(normalizedUrl);
        const sourceJobId = extractLinkedInJobId(normalizedUrl);
        const title = coalesceText(extractJobTitle(extractedJobPage.title), getTitleFromPageTitle(pageTitle));
        const company = coalesceText(extractedJobPage.company, getCompanyFromPageTitle(pageTitle));
        const descriptionText = normalizeDescription(extractedJobPage.descriptionText);

        const jobFields = {
            sourceHostname: normalizedUrlObject.hostname,
            ...(sourceJobId ? { sourceJobId } : {}),
            sourceUrl: normalizedUrl,
            title,
            company,
            ...(extractedJobPage.location ? { location: extractedJobPage.location } : {}),
            ...(descriptionText ? { descriptionText } : {}),
            ...(extractedJobPage.postedAt ? { postedAt: extractedJobPage.postedAt } : {}),
            scrapedAt: new Date().toISOString(),
            ...(extractedJobPage.tags.length > 0 ? { tags: extractedJobPage.tags } : {}),
            duplicateKey: sourceJobId ? `linkedin:${sourceJobId}` : normalizedUrl,
        };

        const embedding = await createJobEmbedding(jobFields);
        let similarity: number | undefined;
        const likedJobsEmbeddings = (await getCollection<StoredScrapedJob>(client, 'jobs').find({ like: true }).toArray()).map(j => j.embedding);
        const firstEmbedding = likedJobsEmbeddings[0];
        if (firstEmbedding) {
            const dimension = firstEmbedding.length;
            const sum: number[] = new Array<number>(dimension).fill(0);
            for (const likedEmbedding of likedJobsEmbeddings) {
                for (let i = 0; i < dimension; i++) {
                    const s = sum[i];
                    const e = likedEmbedding[i];
                    if (typeof s === "number" && typeof e === "number") {
                        sum[i] = s + e;
                    }
                }
            }
            const averageEmbedding = sum.map(v => v / likedJobsEmbeddings.length);
            similarity = calculateCosineSimilarity(embedding, averageEmbedding);
        }
        response.status(200).json({ ...jobFields, embedding, ...(similarity !== undefined ? { cosineSimilarity: similarity } : {}) });
    } catch (error) {
        createErrorMessage(response, error, "Failed to scrape job page.", getScraperErrorStatus(error));
    } finally {
        if (browser) {
            await browser.close();
        }
        await client.close();
    }
}

export function getUrlFromBody(body: unknown): string | null {
    if (!body || typeof body !== "object" || !("url" in body)) {
        return null;
    }

    const url = body.url;

    if (typeof url !== "string" || url.trim().length === 0) {
        return null;
    }

    try {
        return new URL(url.trim()).toString();
    } catch {
        return null;
    }
}

async function extractLinkedInJobPage(page: Page): Promise<ExtractedLinkedInJobPage> {
    await page.click('#base-contextual-sign-in-modal > div > section > button');
    await page.click('button.show-more-less-button');
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

        function normalizeRenderedDescription(value: string): string | null {
            const normalizedValue = value
                .replace(/\u00a0/g, " ")
                .replace(/\r\n?/g, "\n")
                .replace(/[\t ]+\n/g, "\n")
                .replace(/\n[\t ]+/g, "\n")
                .replace(/[\t ]{2,}/g, " ")
                .replace(/\n{3,}/g, "\n\n")
                .trim();

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

            return normalizeRenderedDescription(renderDescriptionNodes(Array.from(template.content.childNodes)));
        }

        function wrapFormattedDescriptionText(marker: string, value: string): string {
            const normalizedValue = value.replace(/\u00a0/g, " ").replace(/[\t ]+/g, " ");
            const leadingSpace = /^[\t ]/.test(normalizedValue) ? " " : "";
            const trailingNewlines = normalizedValue.match(/\n+$/)?.[0] ?? "";
            const trailingSpace = trailingNewlines ? "" : /[\t ]$/.test(normalizedValue) ? " " : "";
            const content = normalizedValue.trim();

            return content ? `${leadingSpace}${marker}${content}${marker}${trailingNewlines}${trailingSpace}` : "";
        }

        function renderDescriptionNode(node: Node): string {
            if (node.nodeType === Node.TEXT_NODE) {
                return node.textContent ?? "";
            }

            if (!(node instanceof HTMLElement)) {
                return "";
            }

            const tagName = node.tagName.toLowerCase();

            if (tagName === "br") {
                return "\n";
            }

            const renderedChildren = renderDescriptionNodes(Array.from(node.childNodes));

            if (tagName === "strong" || tagName === "b") {
                return wrapFormattedDescriptionText("**", renderedChildren);
            }

            if (tagName === "em" || tagName === "i") {
                return wrapFormattedDescriptionText("*", renderedChildren);
            }

            if (tagName === "li") {
                return `\n- ${normalizeRenderedDescription(renderedChildren) ?? ""}`;
            }

            if (tagName === "ul" || tagName === "ol") {
                return `\n${renderedChildren}\n\n`;
            }

            return renderedChildren;
        }

        function renderDescriptionNodes(nodes: Node[]): string {
            return nodes.map(renderDescriptionNode).join("");
        }

        function getFirstDescription(selectors: string[]): string | null {
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                const description = element ? normalizeRenderedDescription(renderDescriptionNode(element)) : null;

                if (description) {
                    return description;
                }
            }

            return null;
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
        const descriptionText = getFirstDescription(descriptionSelectors) ?? stripHtml(getString(jobPosting?.["description"])) ?? getMetaContent(["description", "og:description"]);
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
    const normalizedValue = normalizeMultilineText(value);

    if (!normalizedValue || isModalOrLegalText(normalizedValue)) {
        return null;
    }

    return normalizedValue;
}

function normalizeMultilineText(value: string | null | undefined): string | null {
    const normalizedValue = value
        ?.replace(/\r\n?/g, "\n")
        .replace(/[\t ]+\n/g, "\n")
        .replace(/\n[\t ]+/g, "\n")
        .replace(/[\t ]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim() ?? "";

    return normalizedValue.length > 0 ? normalizedValue : null;
}

function normalizeText(value: string | null | undefined): string | null {
    const normalizedValue = value?.replace(/\s+/g, " ").trim() ?? "";

    return normalizedValue.length > 0 ? normalizedValue : null;
}

function stripLinkedInSuffix(value: string | null | undefined): string | null {
    return normalizeText(value?.replace(/\s*\|\s*LinkedIn$/i, ""));
}

function extractJobTitle(value: string | null | undefined): string | null {
    const withoutSuffix = stripLinkedInSuffix(value);
    if (!withoutSuffix) return null;

    const suchtMatch = withoutSuffix.match(/^.+?\s+sucht\s+(.+?)(?:\s+in\s+\S.*)?$/i);
    if (suchtMatch) return normalizeText(suchtMatch[1]);

    return withoutSuffix;
}

function getTitleFromPageTitle(pageTitle: string): string | null {
    const normalizedPageTitle = normalizeText(pageTitle);

    if (!normalizedPageTitle) {
        return null;
    }

    const titleWithoutLinkedIn = stripLinkedInSuffix(normalizedPageTitle) ?? normalizedPageTitle;

    const atBeiMatch = titleWithoutLinkedIn.match(/^(.+?)\s+(?:at|bei)\s+.+$/i);
    if (atBeiMatch) return normalizeText(atBeiMatch[1]);

    const suchtMatch = titleWithoutLinkedIn.match(/^.+?\s+sucht\s+(.+?)(?:\s+in\s+\S.*)?$/i);
    if (suchtMatch) return normalizeText(suchtMatch[1]);

    return normalizeText(titleWithoutLinkedIn);
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