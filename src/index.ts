import express, { type Request, type Response } from "express";

import { scrapeLinkedInJobPage } from "#scrapers/linkedin/jobPageScraper.js";
import { scrapeLinkedInJobLinks } from "#scrapers/linkedin/jobLinkScraper.js";

const app = express();

const START_PORT = 3000;

app.use(express.json({ limit: "64kb" }));

app.get("/health", (_request: Request, response: Response): void => {
    response.status(200).json({ status: "ok" });
});

app.post("/scrape/linkedin/job-links", scrapeLinkedInJobLinks);

app.post("/scrape/job-page", scrapeLinkedInJobPage);

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