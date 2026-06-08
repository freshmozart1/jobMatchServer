import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { Response } from "express";

const OLLAMA_VERSION_URL = "http://127.0.0.1:11434/api/version";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

type TrackedOllamaProcess = {
    process: ChildProcess;
    exited: boolean;
    spawnError: Error | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
};

let trackedOllamaProcess: TrackedOllamaProcess | null = null;

type FetchLike = typeof fetch;
type SpawnOptions = {
    stdio: "ignore";
};

export type SpawnOllama = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

type StartOllamaOptions = {
    fetchImpl?: FetchLike;
    spawnImpl?: SpawnOllama;
    startupTimeoutMs?: number;
    pollIntervalMs?: number;
};

export function sendOllamaUnavailableResponse(response: Response): void {
    response.status(503).json({ message: "Ollama not available" });
}

export async function isOllamaAvailable(fetchImpl: FetchLike = fetch): Promise<boolean> {
    try {
        const response = await fetchImpl(OLLAMA_VERSION_URL);
        return response.ok;
    } catch {
        return false;
    }
}

function clearTrackedOllamaProcessIfCurrent(trackedProcess: TrackedOllamaProcess): void {
    if (trackedOllamaProcess === trackedProcess) {
        trackedOllamaProcess = null;
    }
}

function createSpawnError(error: Error): Error {
    return new Error("Failed to start `ollama serve`", { cause: error });
}

function createProcessExitedError(trackedProcess: TrackedOllamaProcess): Error {
    const details = [
        trackedProcess.exitCode === null ? null : `code ${trackedProcess.exitCode}`,
        trackedProcess.signal === null ? null : `signal ${trackedProcess.signal}`,
    ].filter((detail): detail is string => Boolean(detail));
    const detailsText = details.length > 0 ? ` (${details.join(", ")})` : "";

    return new Error(`Ollama process exited before becoming available${detailsText}`);
}

function assertTrackedProcessCanStillStartOllama(trackedProcess: TrackedOllamaProcess): void {
    if (trackedProcess.spawnError) {
        throw createSpawnError(trackedProcess.spawnError);
    }

    if (trackedProcess.exited) {
        throw createProcessExitedError(trackedProcess);
    }
}

function isTrackedOllamaProcessRunning(): boolean {
    return Boolean(
        trackedOllamaProcess
        && !trackedOllamaProcess.exited
        && !trackedOllamaProcess.spawnError
        && !trackedOllamaProcess.process.killed,
    );
}

function spawnOllamaServe(spawnImpl: SpawnOllama): TrackedOllamaProcess {
    const childProcess = spawnImpl("ollama", ["serve"], {
        stdio: "ignore",
    });
    const trackedProcess: TrackedOllamaProcess = {
        process: childProcess,
        exited: false,
        spawnError: null,
        exitCode: null,
        signal: null,
    };

    trackedOllamaProcess = trackedProcess;

    childProcess.once("error", (error: Error) => {
        trackedProcess.spawnError = error;
        trackedProcess.exited = true;
        clearTrackedOllamaProcessIfCurrent(trackedProcess);
    });

    childProcess.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        trackedProcess.exited = true;
        trackedProcess.exitCode = code;
        trackedProcess.signal = signal;
        clearTrackedOllamaProcessIfCurrent(trackedProcess);
    });

    childProcess.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
        trackedProcess.exited = true;
        trackedProcess.exitCode = trackedProcess.exitCode ?? code;
        trackedProcess.signal = trackedProcess.signal ?? signal;
        clearTrackedOllamaProcessIfCurrent(trackedProcess);
    });

    childProcess.unref();

    return trackedProcess;
}

async function waitForOllama(fetchImpl: FetchLike, startupTimeoutMs: number, pollIntervalMs: number, trackedProcess: TrackedOllamaProcess): Promise<boolean> {
    const deadline = Date.now() + startupTimeoutMs;

    while (Date.now() <= deadline) {
        assertTrackedProcessCanStillStartOllama(trackedProcess);

        if (await isOllamaAvailable(fetchImpl)) {
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    assertTrackedProcessCanStillStartOllama(trackedProcess);

    return false;
}

export async function startOllamaIfUnavailable(options: StartOllamaOptions = {}): Promise<void> {
    const {
        fetchImpl = fetch,
        spawnImpl = spawn,
        startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
        pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    } = options;

    if (await isOllamaAvailable(fetchImpl)) {
        return;
    }

    if (!isTrackedOllamaProcessRunning()) {
        spawnOllamaServe(spawnImpl);
    }

    if (!trackedOllamaProcess) {
        throw new Error("Ollama process exited before becoming available");
    }

    if (await waitForOllama(fetchImpl, startupTimeoutMs, pollIntervalMs, trackedOllamaProcess)) {
        return;
    }

    throw new Error("Ollama did not become available after starting `ollama serve`");
}

export async function tryStartOllama(options: StartOllamaOptions = {}): Promise<boolean> {
    try {
        await startOllamaIfUnavailable(options);

        return true;
    } catch {
        return false;
    }
}

export function clearTrackedOllamaProcess(): void {
    trackedOllamaProcess = null;
}
