import express, {} from "express";
import { scrapeLinkedInJobPage } from "#scrapers/linkedin/jobPageScraper.js";
import { scrapeLinkedInJobLinks } from "#scrapers/linkedin/jobLinkScraper.js";
import createJobInDatabase from "#database/createJobInDatabase.js";
import { startOllamaIfUnavailable } from "./ollama/ollamaServer.js";
export const app = express();
const START_PORT = 3000;
app.use(express.json({ limit: "64kb" }));
app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
});
app.post("/scrape/linkedin/job-links", scrapeLinkedInJobLinks);
app.post("/scrape/linkedin/job-page", scrapeLinkedInJobPage);
app.post('/create/job', createJobInDatabase);
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
    try {
        await startOllamaIfUnavailable();
        listenWithFallback(START_PORT);
    }
    catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
void startServer();
//# sourceMappingURL=index.js.map