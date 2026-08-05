// fallow-ignore-file security-sink
// One flagged sink, verified 2026-07:
// - spawn(PYTHON_BINARY, [TOKEN_SERVICE_SCRIPT], ...) in startTokenService():
//   both args are resolved from local environment/filesystem at startup
//   (env var, venv path, or `pip` shebang parsing), never from an HTTP
//   request.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { join } from 'node:path';
import type { Readable } from 'node:stream';

import { resolvePythonBinary } from './resolvePythonBinary.js';

export const TOKEN_SERVICE_URL_ENV = 'TOKEN_SERVICE_URL';
const TOKEN_SERVICE_READY_PREFIX = `${TOKEN_SERVICE_URL_ENV}=`;
const TOKEN_SERVICE_SCRIPT = join(
    process.cwd(),
    'src',
    'tokenService',
    'tokenService.py',
);
const TOKEN_SERVICE_START_TIMEOUT_MS = 10_000;
const PYTHON_BINARY = resolvePythonBinary();

export type TokenServiceStart = {
    url: string;
    childProcess: TokenServiceProcess;
};

export type TokenServiceProcess = ChildProcessByStdio<null, Readable, Readable>;

let tokenServiceStartPromise: Promise<TokenServiceStart> | undefined;
let tokenServiceProcess: TokenServiceProcess | undefined;

export function killTokenServiceProcess(): void {
    tokenServiceProcess?.kill();
}

export function appendChunkAndFlushLines(
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

export function startTokenService(): Promise<TokenServiceStart> {
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

export function ensureTokenServiceStarted(): Promise<TokenServiceStart> {
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
