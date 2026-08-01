// fallow-ignore-file security-sink
// Two flagged sinks, both verified 2026-07:
// - response.setHeader('Access-Control-Allow-Origin', origin): origin is
//   checked against ALLOWED_ORIGINS/LAN_ORIGIN_PATTERN before use (see the
//   CORS middleware below) — only a fixed allowlist of values ever reaches
//   the header.
// - spawn(PYTHON_BINARY, [TOKEN_SERVICE_SCRIPT], ...) in startTokenService():
//   both args are resolved from local environment/filesystem at startup
//   (env var, venv path, or `pip` shebang parsing), never from an HTTP
//   request.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import {
    accessSync,
    constants as fsConstants,
    existsSync,
    readFileSync,
} from 'node:fs';
import type { Server } from 'node:http';
import { delimiter, join } from 'node:path';
import type { Readable } from 'node:stream';

import express, { type Request, type Response } from 'express';

import { scrapeJob } from '#scrapers/linkedin/scrapeJob.js';
import createJobInDatabase from '#database/createJobInDatabase.js';
import getTopXSimilarCoverLetters from '#database/getTopXSimilarCoverLetters.js';
import uploadCoverLetterAsText from '#database/uploadCoverLetterAsText.js';
import generateCoverLetterAsText from './coverLetters/generateCoverLettersAsText.js';
import countTokens from './tokens/calculateTokens.js';
import multer from 'multer';
import uploadCV from '#database/uploadCV.js';
import getCV from '#database/getCV.js';
import getCVStatus from '#database/getCVStatus.js';
import uploadCertificates from '#database/uploadCertificates.js';
import getCertificatesStatus from '#database/getCertificatesStatus.js';
import getApplication from '#database/getApplication.js';
import getCoverLetterPdf from '#database/getCoverLetterPdf.js';
import { closeAllTrackedBrowserServers } from '#utils/trackedPlaywrightBrowsers.js';

export const app = express();

const START_PORT = 3000;
const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);
const LAN_ORIGIN_PATTERN = /^http:\/\/192\.168\.\d+\.\d+:5173$/;
const TOKEN_SERVICE_URL_ENV = 'TOKEN_SERVICE_URL';
const TOKEN_SERVICE_READY_PREFIX = `${TOKEN_SERVICE_URL_ENV}=`;
const TOKEN_SERVICE_SCRIPT = join(
    process.cwd(),
    'src',
    'tokenService',
    'tokenService.py',
);
const TOKEN_SERVICE_START_TIMEOUT_MS = 10_000;
const LOCAL_PYTHON_BINARY = join(process.cwd(), '.venv', 'bin', 'python');
const PYTHON_BINARY = resolvePythonBinary();

type TokenServiceStart = {
    url: string;
    childProcess: TokenServiceProcess;
};

type TokenServiceProcess = ChildProcessByStdio<null, Readable, Readable>;

let tokenServiceStartPromise: Promise<TokenServiceStart> | undefined;
let tokenServiceProcess: TokenServiceProcess | undefined;
let activeServer: Server | undefined;
let shutdownHandlersRegistered = false;
let isShuttingDown = false;

function findExecutable(command: string): string | undefined {
    const pathDirectories = process.env['PATH']?.split(delimiter) ?? [];

    for (const directory of pathDirectories) {
        const executablePath = join(directory, command);

        try {
            accessSync(executablePath, fsConstants.X_OK);
            return executablePath;
        } catch {
            continue;
        }
    }

    return undefined;
}

function resolvePythonBinaryFromPip(command: string): string | undefined {
    const pipPath = findExecutable(command);

    if (!pipPath) {
        return undefined;
    }

    const [firstLine] = readFileSync(pipPath, 'utf8').split('\n');
    const shebang = firstLine?.startsWith('#!')
        ? firstLine.slice(2).trim()
        : undefined;

    if (!shebang) {
        return undefined;
    }

    const [executable, ...args] = shebang.split(/\s+/);

    if (!executable) {
        return undefined;
    }

    if (executable.endsWith('/env')) {
        return args[0];
    }

    return executable;
}

function resolvePythonBinary(): string {
    return (
        process.env['PYTHON'] ??
        (existsSync(LOCAL_PYTHON_BINARY) ? LOCAL_PYTHON_BINARY : undefined) ??
        resolvePythonBinaryFromPip('pip') ??
        resolvePythonBinaryFromPip('pip3') ??
        'python3'
    );
}

app.use((request: Request, response: Response, next): void => {
    const origin = request.get('origin');

    if (
        origin &&
        (ALLOWED_ORIGINS.has(origin) || LAN_ORIGIN_PATTERN.test(origin))
    ) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        response.sendStatus(204);
        return;
    }

    next();
});

app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request: Request, response: Response): void => {
    response.status(200).json({ status: 'ok' });
});

app.post('/scrape/linkedin/playwright', scrapeJob);

app.post('/jobs/create', createJobInDatabase);

app.post('/jobs/top-x-similar-cover-letters', getTopXSimilarCoverLetters);

app.post('/cover-letters/upload/text', uploadCoverLetterAsText);

app.get('/cover-letters/:jobDuplicateKey', getCoverLetterPdf);

//TODO: #26 Check if multer allows uploading any file and if it does, restrict it to only allow PDF files. Also, check if the file is actually a PDF and not just a file with a .pdf extension.
const upload = multer({ dest: `uploads/cv` });
app.post('/cv/upload', upload.single('file'), uploadCV);

app.get('/cv/:jobDuplicateKey', getCV);

app.get('/cv/:jobDuplicateKey/status', getCVStatus);

app.get('/certificates/:jobDuplicateKey/status', getCertificatesStatus);

//TODO #29
const uploadCertificateFiles = multer({
    dest: 'uploads/certificates',
    limits: { fileSize: 10 * 1024 * 1024 },
});
app.post(
    '/certificates/upload',
    uploadCertificateFiles.array('files', 10),
    uploadCertificates,
);

app.post('/cover-letters/create/text', generateCoverLetterAsText);

app.post('/tokens/count', countTokens);

app.get('/application/:jobDuplicateKey', getApplication);

function appendChunkAndFlushLines(
    bufferedText: string,
    chunk: Buffer,
    handleLine: (line: string) => void,
): string {
    let nextBufferedText = bufferedText + chunk.toString();
    let newlineIndex = nextBufferedText.indexOf('\n');

    while (newlineIndex !== -1) {
        const line = nextBufferedText.slice(0, newlineIndex).trim();
        nextBufferedText = nextBufferedText.slice(newlineIndex + 1);

        if (line.length > 0) {
            handleLine(line);
        }

        newlineIndex = nextBufferedText.indexOf('\n');
    }

    return nextBufferedText;
}

function startTokenService(): Promise<TokenServiceStart> {
    const childProcess = spawn(PYTHON_BINARY, [TOKEN_SERVICE_SCRIPT], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    tokenServiceProcess = childProcess;

    return new Promise((resolve, reject) => {
        let stdoutBuffer = '';
        let stderrBuffer = '';
        let isSettled = false;

        const startupTimeout = setTimeout(() => {
            fail(
                new Error(
                    `Token service did not report ${TOKEN_SERVICE_URL_ENV} within ${TOKEN_SERVICE_START_TIMEOUT_MS}ms`,
                ),
            );
        }, TOKEN_SERVICE_START_TIMEOUT_MS);

        function succeed(url: string): void {
            if (isSettled) {
                return;
            }

            isSettled = true;
            clearTimeout(startupTimeout);
            resolve({ url, childProcess });
        }

        function fail(error: Error): void {
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

        function handleStdoutLine(line: string): void {
            console.log(`[tokenService] ${line}`);

            if (!line.startsWith(TOKEN_SERVICE_READY_PREFIX)) {
                return;
            }

            const url = line.slice(TOKEN_SERVICE_READY_PREFIX.length).trim();

            if (!url) {
                fail(
                    new Error(
                        `Token service reported an empty ${TOKEN_SERVICE_URL_ENV}`,
                    ),
                );
                return;
            }

            succeed(url);
        }

        function handleStderrLine(line: string): void {
            console.error(`[tokenService] ${line}`);
        }

        childProcess.stdout.on('data', (chunk: Buffer) => {
            stdoutBuffer = appendChunkAndFlushLines(
                stdoutBuffer,
                chunk,
                handleStdoutLine,
            );
        });

        childProcess.stderr.on('data', (chunk: Buffer) => {
            stderrBuffer = appendChunkAndFlushLines(
                stderrBuffer,
                chunk,
                handleStderrLine,
            );
        });

        childProcess.on('error', fail);

        childProcess.on('exit', (code, signal) => {
            if (tokenServiceProcess === childProcess) {
                tokenServiceProcess = undefined;
            }

            if (!isSettled) {
                fail(
                    new Error(
                        `Token service exited before reporting ${TOKEN_SERVICE_URL_ENV}; code=${code ?? 'null'}, signal=${signal ?? 'null'}`,
                    ),
                );
                return;
            }

            if (code !== 0 && signal !== 'SIGTERM' && signal !== 'SIGINT') {
                console.error(
                    `Token service exited unexpectedly; code=${code ?? 'null'}, signal=${signal ?? 'null'}`,
                );
            }
        });
    });
}

function ensureTokenServiceStarted(): Promise<TokenServiceStart> {
    if (!tokenServiceStartPromise) {
        tokenServiceStartPromise = startTokenService().catch(
            (error: unknown) => {
                tokenServiceStartPromise = undefined;
                throw error;
            },
        );
    }

    return tokenServiceStartPromise;
}

function hasErrorCode(error: unknown, code: string): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === code
    );
}

function registerShutdownHandlers(): void {
    if (shutdownHandlersRegistered) {
        return;
    }

    shutdownHandlersRegistered = true;

    const shutdown = (signal: NodeJS.Signals): void => {
        // SIGINT/SIGTERM/SIGUSR2 are all registered with `on` (not `once`) so a
        // second signal arriving mid-shutdown (e.g. a slow-draining server, or two
        // rapid nodemon restarts) still finds a listener instead of falling
        // through to Node's default disposition, which would terminate the
        // process immediately and skip cleanup below. This guard makes that
        // re-entrant case a deliberate, logged force-exit instead.
        if (isShuttingDown) {
            console.log(`Received ${signal} during shutdown, forcing exit...`);
            process.exit(1);
        }

        isShuttingDown = true;
        console.log(`Received ${signal}, shutting down...`);

        void closeAllTrackedBrowserServers().finally(() => {
            tokenServiceProcess?.kill();

            if (!activeServer) {
                process.exit(0);
            }

            activeServer.close((error?: Error) => {
                if (error) {
                    console.error(error);
                    process.exit(1);
                }

                process.exit(0);
            });
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.once('exit', () => {
        tokenServiceProcess?.kill();
    });

    // nodemon restarts by sending SIGUSR2 (its default restart signal, see its
    // README's "graceful reload" section), not SIGINT/SIGTERM, so without this
    // handler every dev-loop restart bypasses `shutdown` above entirely and kills
    // the process with no cleanup, orphaning any in-flight Playwright browser.
    // Clean up, then re-signal SIGTERM (already handled by `shutdown`) so
    // nodemon's restart proceeds. This assumes a nodemon-managed local dev
    // process — this project currently has no other deployment/process-manager
    // path, so no environment gating is added here.
    process.on('SIGUSR2', () => {
        closeAllTrackedBrowserServers()
            .catch(() => undefined)
            .finally(() => {
                process.kill(process.pid, 'SIGTERM');
            });
    });
}

async function listenWithFallback(
    port: number,
    tokenServiceUrl?: string,
): Promise<Server> {
    const resolvedTokenServiceUrl =
        tokenServiceUrl ?? (await ensureTokenServiceStarted()).url;
    process.env[TOKEN_SERVICE_URL_ENV] = resolvedTokenServiceUrl;
    registerShutdownHandlers();

    return new Promise((resolve, reject) => {
        const server = app
            .listen(port)
            .on('listening', () => {
                activeServer = server;
                console.log(
                    `Token service running on ${resolvedTokenServiceUrl}`,
                );
                console.log(`Server running on http://localhost:${port}`);
                resolve(server);
            })
            .on('error', (err: unknown) => {
                if (hasErrorCode(err, 'EADDRINUSE')) {
                    console.log(`Port ${port} in use, trying ${port + 1}...`);
                    listenWithFallback(port + 1, resolvedTokenServiceUrl).then(
                        resolve,
                        reject,
                    );
                    return;
                }

                reject(err);
            });
    });
}

console.log(
    'MongoDB connection string:',
    process.env['MONGODB_CONNECTION_STRING'],
);

void listenWithFallback(START_PORT).catch((error: unknown) => {
    console.error(error);
    tokenServiceProcess?.kill();
    process.exit(1);
});
