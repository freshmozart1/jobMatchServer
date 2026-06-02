import { spawn } from "node:child_process";
const OLLAMA_VERSION_URL = "http://127.0.0.1:11434/api/version";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
let ollamaProcess = null;
export async function isOllamaAvailable(fetchImpl = fetch) {
    try {
        const response = await fetchImpl(OLLAMA_VERSION_URL);
        return response.ok;
    }
    catch {
        return false;
    }
}
async function waitForOllama(fetchImpl, startupTimeoutMs, pollIntervalMs) {
    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() <= deadline) {
        if (await isOllamaAvailable(fetchImpl)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    return false;
}
export async function startOllamaIfUnavailable(options = {}) {
    const { fetchImpl = fetch, spawnImpl = spawn, startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, } = options;
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
export async function tryStartOllama(options = {}) {
    try {
        await startOllamaIfUnavailable(options);
        return true;
    }
    catch {
        return false;
    }
}
export function clearTrackedOllamaProcess() {
    ollamaProcess = null;
}
//# sourceMappingURL=ollamaServer.js.map