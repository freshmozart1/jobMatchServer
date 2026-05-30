import express, { type Request, type Response } from "express";

import { isSupportedLinkedInJobPageUrl, scrapeLinkedInJobPage } from "./scrapers/linkedin/jobPageScraper.js";
import { isSupportedLinkedInJobSearchUrl, scrapeLinkedInJobLinks } from "./scrapers/linkedin/jobLinkScraper.js";
import type { ScrapedJob } from "./scrapers/linkedin/types.js";

const app = express();

const START_PORT = 3000;

app.use(express.json({ limit: "64kb" }));

app.get("/health", (_request: Request, response: Response): void => {
    response.status(200).json({ status: "ok" });
});

app.post("/scrape/linkedin/job-links", async (request: Request, response: Response): Promise<void> => {
    const searchUrl = getSearchUrlFromBody(request.body);

    if (!searchUrl) {
        response.status(400).json({ error: "Request body must include a string searchUrl." });
        return;
    }

    if (!isSupportedLinkedInJobSearchUrl(searchUrl)) {
        response.status(422).json({ error: "Only LinkedIn jobs search URLs are supported." });
        return;
    }

    try {
        const result = await scrapeLinkedInJobLinks(searchUrl);

        response.status(200).json(result);
    } catch (error) {
        response.status(getScraperErrorStatus(error)).json({
            error: "Failed to scrape LinkedIn job links.",
            message: getErrorMessage(error),
        });
    }
});

app.post("/scrape/job-page", async (request: Request, response: Response): Promise<void> => {
    const jobPageUrl = getUrlFromBody(request.body);

    if (!jobPageUrl) {
        response.status(400).json({ error: "Request body must include a valid string url." });
        return;
    }

    const scraper = getJobPageScraper(jobPageUrl);

    if (!scraper) {
        response.status(422).json({ error: "No job page scraper is registered for this URL." });
        return;
    }

    try {
        const result = await scraper.scrape(jobPageUrl);

        response.status(200).json(result);
    } catch (error) {
        response.status(getScraperErrorStatus(error)).json({
            error: "Failed to scrape job page.",
            message: getErrorMessage(error),
        });
    }
});

type JobPageScraper = {
    isSupported: (url: string) => boolean;
    scrape: (url: string) => Promise<ScrapedJob>;
};

const jobPageScrapers: JobPageScraper[] = [
    {
        isSupported: isSupportedLinkedInJobPageUrl,
        scrape: scrapeLinkedInJobPage,
    },
];

function getJobPageScraper(jobPageUrl: string): JobPageScraper | null {
    return jobPageScrapers.find((scraper) => scraper.isSupported(jobPageUrl)) ?? null;
}

function getSearchUrlFromBody(body: unknown): string | null {
    if (!body || typeof body !== "object" || !("searchUrl" in body)) {
        return null;
    }

    const searchUrl = body.searchUrl;

    return typeof searchUrl === "string" && searchUrl.trim().length > 0 ? searchUrl.trim() : null;
}

function getUrlFromBody(body: unknown): string | null {
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

function getScraperErrorStatus(error: unknown): number {
    if (error instanceof Error && error.message.toLowerCase().includes("timeout")) {
        return 504;
    }

    return 502;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown scraper error.";
}

function listenWithFallback(port: number) {
    const server = app
        .listen(port)
        .on("listening", () => {
            console.log(`Server running on http://localhost:${port}`);
        })
        .on("error", (err: unknown) => {
            if (err && typeof err === "object" && "code" in err && err.code === "EADDRINUSE") {
                console.log(`Port ${port} in use, trying ${port + 1}...`);
                listenWithFallback(port + 1);
            } else {
                console.error(err);
            }
        });

    return server;
}

listenWithFallback(START_PORT);