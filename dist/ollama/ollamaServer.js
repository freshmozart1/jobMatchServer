import { spawn } from "node:child_process";
const OLLAMA_VERSION_URL = "http://127.0.0.1:11434/api/version";
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
let trackedOllamaProcess = null;
export function sendOllamaUnavailableResponse(response) {
    response.status(503).json({ message: "Ollama not available" });
}
export async function isOllamaAvailable(fetchImpl = fetch) {
    try {
        const response = await fetchImpl(OLLAMA_VERSION_URL);
        return response.ok;
    }
    catch {
        return false;
    }
}
function clearTrackedOllamaProcessIfCurrent(trackedProcess) {
    if (trackedOllamaProcess === trackedProcess) {
        trackedOllamaProcess = null;
    }
}
function createSpawnError(error) {
    return new Error("Failed to start `ollama serve`", { cause: error });
}
function createProcessExitedError(trackedProcess) {
    const details = [
        trackedProcess.exitCode === null ? null : `code ${trackedProcess.exitCode}`,
        trackedProcess.signal === null ? null : `signal ${trackedProcess.signal}`,
    ].filter((detail) => Boolean(detail));
    const detailsText = details.length > 0 ? ` (${details.join(", ")})` : "";
    return new Error(`Ollama process exited before becoming available${detailsText}`);
}
function assertTrackedProcessCanStillStartOllama(trackedProcess) {
    if (trackedProcess.spawnError) {
        throw createSpawnError(trackedProcess.spawnError);
    }
    if (trackedProcess.exited) {
        throw createProcessExitedError(trackedProcess);
    }
}
function isTrackedOllamaProcessRunning() {
    return Boolean(trackedOllamaProcess
        && !trackedOllamaProcess.exited
        && !trackedOllamaProcess.spawnError
        && !trackedOllamaProcess.process.killed);
}
function spawnOllamaServe(spawnImpl) {
    const childProcess = spawnImpl("ollama", ["serve"], {
        stdio: "ignore",
    });
    const trackedProcess = {
        process: childProcess,
        exited: false,
        spawnError: null,
        exitCode: null,
        signal: null,
    };
    trackedOllamaProcess = trackedProcess;
    childProcess.once("error", (error) => {
        trackedProcess.spawnError = error;
        trackedProcess.exited = true;
        clearTrackedOllamaProcessIfCurrent(trackedProcess);
    });
    childProcess.once("exit", (code, signal) => {
        trackedProcess.exited = true;
        trackedProcess.exitCode = code;
        trackedProcess.signal = signal;
        clearTrackedOllamaProcessIfCurrent(trackedProcess);
    });
    childProcess.once("close", (code, signal) => {
        trackedProcess.exited = true;
        trackedProcess.exitCode = trackedProcess.exitCode ?? code;
        trackedProcess.signal = trackedProcess.signal ?? signal;
        clearTrackedOllamaProcessIfCurrent(trackedProcess);
    });
    childProcess.unref();
    return trackedProcess;
}
async function waitForOllama(fetchImpl, startupTimeoutMs, pollIntervalMs, trackedProcess) {
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
export async function startOllamaIfUnavailable(options = {}) {
    const { fetchImpl = fetch, spawnImpl = spawn, startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, } = options;
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
    trackedOllamaProcess = null;
}
//# sourceMappingURL=ollamaServer.js.map