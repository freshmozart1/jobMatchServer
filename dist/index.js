import express, {} from "express";
import { scrapeLinkedInJobPage } from "#scrapers/linkedin/jobPageScraper.js";
import { scrapeLinkedInJobLinks } from "#scrapers/linkedin/jobLinkScraper.js";
import createJobInDatabase from "#database/createJobInDatabase.js";
import getTopXSimilarCoverLetters from "#database/getTopXSimilarCoverLetters.js";
import filterJobLinks from "#database/filterJobLinks.js";
import { tryStartOllama } from "./ollama/ollamaServer.js";
import uploadCoverLetterAsText from "#database/uploadCoverLetterAsText.js";
export const app = express();
const START_PORT = 3000;
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") {
        response.sendStatus(204);
        return;
    }
    next();
});
app.use(express.json({ limit: "64kb" }));
app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
});
app.post("/scrape/linkedin/job-links", scrapeLinkedInJobLinks);
app.post("/scrape/linkedin/job-page", scrapeLinkedInJobPage);
app.post('/jobs/create', createJobInDatabase);
app.post('/jobs/filter-job-links', filterJobLinks);
app.get('/jobs/top-x-similar-cover-letters', getTopXSimilarCoverLetters);
app.post('/cover-letters/upload/text', uploadCoverLetterAsText);
function listenWithFallback(port) {
    const server = app
        .listen(port)
        .on("listening", () => {
        console.log(`Server running on http://localhost:${port}`);
    })
        .on("error", (err) => {
        if (err && typeof err === "object" && "code" in err && err.code === "EADDRINUSE") {
            console.log(`Port ${port} in use, trying ${port + 1}...`);
            listenWithFallback(port + 1);
        }
        else {
            console.error(err);
        }
    });
    return server;
}
async function startServer() {
    const isOllamaReady = await tryStartOllama();
    if (!isOllamaReady) {
        console.warn("Ollama not available. /jobs/create will return 503 until Ollama is available.");
    }
    listenWithFallback(START_PORT);
}
void startServer();
//# sourceMappingURL=index.js.map