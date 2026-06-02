import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

const OLLAMA_VERSION_URL = "http://127.0.0.1:11434/api/version";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

let ollamaProcess: ChildProcess | null = null;

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

export async function isOllamaAvailable(fetchImpl: FetchLike = fetch): Promise<boolean> {
    try {
        const response = await fetchImpl(OLLAMA_VERSION_URL);
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForOllama(fetchImpl: FetchLike, startupTimeoutMs: number, pollIntervalMs: number): Promise<boolean> {
    const deadline = Date.now() + startupTimeoutMs;

    while (Date.now() <= deadline) {
        if (await isOllamaAvailable(fetchImpl)) {
            return true;
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

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

    if (!ollamaProcess || ollamaProcess.killed) {
        ollamaProcess = spawnImpl("ollama", ["serve"], {
            stdio: "ignore",
        });
        ollamaProcess.unref();
    }

    if (await waitForOllama(fetchImpl, startupTimeoutMs, pollIntervalMs)) {
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
    ollamaProcess = null;
}