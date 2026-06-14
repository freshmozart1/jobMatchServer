import { spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import express, {} from "express";
import { scrapeLinkedInJobPage } from "#scrapers/linkedin/jobPageScraper.js";
import { scrapeLinkedInJobLinks } from "#scrapers/linkedin/jobLinkScraper.js";
import createJobInDatabase from "#database/createJobInDatabase.js";
import getTopXSimilarCoverLetters from "#database/getTopXSimilarCoverLetters.js";
import filterJobLinks from "#database/filterJobLinks.js";
import uploadCoverLetterAsText from "#database/uploadCoverLetterAsText.js";
import generateCoverLetterAsText from "./coverLetters/generateCoverLettersAsText.js";
import countTokens from "./tokens/calculateTokens.js";
import multer from "multer";
import uploadCV from "#database/uploadCV.js";
export const app = express();
const START_PORT = 3000;
const ALLOWED_ORIGINS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const LAN_ORIGIN_PATTERN = /^http:\/\/192\.168\.\d+\.\d+:5173$/;
const TOKEN_SERVICE_URL_ENV = "TOKEN_SERVICE_URL";
const TOKEN_SERVICE_READY_PREFIX = `${TOKEN_SERVICE_URL_ENV}=`;
const TOKEN_SERVICE_SCRIPT = join(process.cwd(), "src", "tokenService", "tokenService.py");
const TOKEN_SERVICE_START_TIMEOUT_MS = 10_000;
const LOCAL_PYTHON_BINARY = join(process.cwd(), ".venv", "bin", "python");
const PYTHON_BINARY = resolvePythonBinary();
let tokenServiceStartPromise;
let tokenServiceProcess;
let activeServer;
let shutdownHandlersRegistered = false;
function findExecutable(command) {
    const pathDirectories = process.env["PATH"]?.split(delimiter) ?? [];
    for (const directory of pathDirectories) {
        const executablePath = join(directory, command);
        try {
            accessSync(executablePath, fsConstants.X_OK);
            return executablePath;
        }
        catch {
            continue;
        }
    }
    return undefined;
}
function resolvePythonBinaryFromPip(command) {
    const pipPath = findExecutable(command);
    if (!pipPath) {
        return undefined;
    }
    const [firstLine] = readFileSync(pipPath, "utf8").split("\n");
    const shebang = firstLine?.startsWith("#!") ? firstLine.slice(2).trim() : undefined;
    if (!shebang) {
        return undefined;
    }
    const [executable, ...args] = shebang.split(/\s+/);
    if (!executable) {
        return undefined;
    }
    if (executable.endsWith("/env")) {
        return args[0];
    }
    return executable;
}
function resolvePythonBinary() {
    return (process.env["PYTHON"] ??
        (existsSync(LOCAL_PYTHON_BINARY) ? LOCAL_PYTHON_BINARY : undefined) ??
        resolvePythonBinaryFromPip("pip") ??
        resolvePythonBinaryFromPip("pip3") ??
        "python3");
}
app.use((request, response, next) => {
    const origin = request.get("origin");
    if (origin && (ALLOWED_ORIGINS.has(origin) || LAN_ORIGIN_PATTERN.test(origin))) {
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
const upload = multer({ dest: `uploads/cv` });
app.post('/cv/upload', upload.single('file'), uploadCV);
app.post('/cover-letters/create/text', generateCoverLetterAsText);
app.post('/tokens/count', countTokens);
function appendChunkAndFlushLines(bufferedText, chunk, handleLine) {
    let nextBufferedText = bufferedText + chunk.toString();
    let newlineIndex = nextBufferedText.indexOf("\n");
    while (newlineIndex !== -1) {
        const line = nextBufferedText.slice(0, newlineIndex).trim();
        nextBufferedText = nextBufferedText.slice(newlineIndex + 1);
        if (line.length > 0) {
            handleLine(line);
        }
        newlineIndex = nextBufferedText.indexOf("\n");
    }
    return nextBufferedText;
}
function startTokenService() {
    const childProcess = spawn(PYTHON_BINARY, [TOKEN_SERVICE_SCRIPT], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
    });
    tokenServiceProcess = childProcess;
    return new Promise((resolve, reject) => {
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let isSettled = false;
        const startupTimeout = setTimeout(() => {
            fail(new Error(`Token service did not report ${TOKEN_SERVICE_URL_ENV} within ${TOKEN_SERVICE_START_TIMEOUT_MS}ms`));
        }, TOKEN_SERVICE_START_TIMEOUT_MS);
        function succeed(url) {
            if (isSettled) {
                return;
            }
            isSettled = true;
            clearTimeout(startupTimeout);
            resolve({ url, childProcess });
        }
        function fail(error) {
            if (isSettled) {
                return;
            }
            isSettled = true;
            clearTimeout(startupTimeout);
            if (tokenServiceProcess === childProcess) {
                tokenServiceProcess = undefined;
            }
            childProcess.kill();
            reject(error);
        }
        function handleStdoutLine(line) {
            console.log(`[tokenService] ${line}`);
            if (!line.startsWith(TOKEN_SERVICE_READY_PREFIX)) {
                return;
            }
            const url = line.slice(TOKEN_SERVICE_READY_PREFIX.length).trim();
            if (!url) {
                fail(new Error(`Token service reported an empty ${TOKEN_SERVICE_URL_ENV}`));
                return;
            }
            succeed(url);
        }
        function handleStderrLine(line) {
            console.error(`[tokenService] ${line}`);
        }
        childProcess.stdout.on("data", (chunk) => {
            stdoutBuffer = appendChunkAndFlushLines(stdoutBuffer, chunk, handleStdoutLine);
        });
        childProcess.stderr.on("data", (chunk) => {
            stderrBuffer = appendChunkAndFlushLines(stderrBuffer, chunk, handleStderrLine);
        });
        childProcess.on("error", fail);
        childProcess.on("exit", (code, signal) => {
            if (tokenServiceProcess === childProcess) {
                tokenServiceProcess = undefined;
            }
            if (!isSettled) {
                fail(new Error(`Token service exited before reporting ${TOKEN_SERVICE_URL_ENV}; code=${code ?? "null"}, signal=${signal ?? "null"}`));
                return;
            }
            if (code !== 0 && signal !== "SIGTERM" && signal !== "SIGINT") {
                console.error(`Token service exited unexpectedly; code=${code ?? "null"}, signal=${signal ?? "null"}`);
            }
        });
    });
}
function ensureTokenServiceStarted() {
    if (!tokenServiceStartPromise) {
        tokenServiceStartPromise = startTokenService().catch((error) => {
            tokenServiceStartPromise = undefined;
            throw error;
        });
    }
    return tokenServiceStartPromise;
}
function hasErrorCode(error, code) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === code);
}
function registerShutdownHandlers() {
    if (shutdownHandlersRegistered) {
        return;
    }
    shutdownHandlersRegistered = true;
    const shutdown = (signal) => {
        console.log(`Received ${signal}, shutting down...`);
        tokenServiceProcess?.kill();
        if (!activeServer) {
            process.exit(0);
        }
        activeServer.close((error) => {
            if (error) {
                console.error(error);
                process.exit(1);
            }
            process.exit(0);
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.once("exit", () => {
        tokenServiceProcess?.kill();
    });
}
async function listenWithFallback(port, tokenServiceUrl) {
    const resolvedTokenServiceUrl = tokenServiceUrl ?? (await ensureTokenServiceStarted()).url;
    process.env[TOKEN_SERVICE_URL_ENV] = resolvedTokenServiceUrl;
    registerShutdownHandlers();
    return new Promise((resolve, reject) => {
        const server = app
            .listen(port)
            .on("listening", () => {
            activeServer = server;
            console.log(`Token service running on ${resolvedTokenServiceUrl}`);
            console.log(`Server running on http://localhost:${port}`);
            resolve(server);
        })
            .on("error", (err) => {
            if (hasErrorCode(err, "EADDRINUSE")) {
                console.log(`Port ${port} in use, trying ${port + 1}...`);
                listenWithFallback(port + 1, resolvedTokenServiceUrl).then(resolve, reject);
                return;
            }
            reject(err);
        });
    });
}
console.log('MongoDB connection string:', process.env["MONGODB_CONNECTION_STRING"]);
void listenWithFallback(START_PORT).catch((error) => {
    console.error(error);
    tokenServiceProcess?.kill();
    process.exit(1);
});
//# sourceMappingURL=index.js.map