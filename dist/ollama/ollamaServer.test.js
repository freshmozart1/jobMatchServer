import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { EventEmitter } from "node:events";
const { clearTrackedOllamaProcess, isOllamaAvailable, startOllamaIfUnavailable, tryStartOllama } = await import("./ollamaServer.js");
function createFetchResponse(ok) {
    return { ok };
}
function createFetchMock(results) {
    const fetchMock = jest.fn();
    for (const result of results) {
        fetchMock.mockResolvedValueOnce(createFetchResponse(result));
    }
    return fetchMock;
}
class TestOllamaChildProcess extends EventEmitter {
    killed = false;
    unref = jest.fn(() => this);
}
function createSpawnMock() {
    const childProcesses = [];
    const spawnMock = jest.fn();
    spawnMock.mockImplementation(() => {
        const childProcess = new TestOllamaChildProcess();
        childProcesses.push(childProcess);
        return childProcess;
    });
    return { spawnMock, childProcesses };
}
async function waitForSpawn(childProcesses) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (childProcesses.length > 0) {
            return;
        }
        await Promise.resolve();
    }
    throw new Error("Expected Ollama child process to be spawned");
}
describe("ollamaServer", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearTrackedOllamaProcess();
    });
    it("reports Ollama as available when the version endpoint responds ok", async () => {
        const fetchMock = createFetchMock([true]);
        await expect(isOllamaAvailable(fetchMock)).resolves.toBe(true);
        expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:11434/api/version");
    });
    it("does not spawn Ollama when it is already available", async () => {
        const fetchMock = createFetchMock([true]);
        const { spawnMock } = createSpawnMock();
        await startOllamaIfUnavailable({ fetchImpl: fetchMock, spawnImpl: spawnMock });
        expect(spawnMock).not.toHaveBeenCalled();
    });
    it("spawns Ollama when unavailable and waits until it responds", async () => {
        const fetchMock = createFetchMock([false, false, true]);
        const { spawnMock } = createSpawnMock();
        await startOllamaIfUnavailable({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 100,
            pollIntervalMs: 0,
        });
        expect(spawnMock).toHaveBeenCalledWith("ollama", ["serve"], { stdio: "ignore" });
    });
    it("rejects when Ollama does not become available after spawning", async () => {
        const fetchMock = createFetchMock([false, false, false]);
        const { spawnMock } = createSpawnMock();
        await expect(startOllamaIfUnavailable({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 0,
            pollIntervalMs: 0,
        })).rejects.toThrow("Ollama did not become available after starting `ollama serve`");
    });
    it("returns true from best-effort startup when Ollama is already available", async () => {
        const fetchMock = createFetchMock([true]);
        const { spawnMock } = createSpawnMock();
        await expect(tryStartOllama({ fetchImpl: fetchMock, spawnImpl: spawnMock })).resolves.toBe(true);
        expect(spawnMock).not.toHaveBeenCalled();
    });
    it("returns true from best-effort startup after spawning Ollama successfully", async () => {
        const fetchMock = createFetchMock([false, false, true]);
        const { spawnMock } = createSpawnMock();
        await expect(tryStartOllama({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 100,
            pollIntervalMs: 0,
        })).resolves.toBe(true);
        expect(spawnMock).toHaveBeenCalledWith("ollama", ["serve"], { stdio: "ignore" });
    });
    it("returns false from best-effort startup when Ollama does not become available", async () => {
        const fetchMock = createFetchMock([false, false, false]);
        const { spawnMock } = createSpawnMock();
        await expect(tryStartOllama({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 0,
            pollIntervalMs: 0,
        })).resolves.toBe(false);
    });
    it("spawns again after the tracked Ollama process exits", async () => {
        const fetchMock = createFetchMock([false, true, false, true]);
        const { childProcesses, spawnMock } = createSpawnMock();
        await startOllamaIfUnavailable({ fetchImpl: fetchMock, spawnImpl: spawnMock });
        childProcesses[0]?.emit("exit", 1, null);
        await startOllamaIfUnavailable({ fetchImpl: fetchMock, spawnImpl: spawnMock });
        expect(spawnMock).toHaveBeenCalledTimes(2);
    });
    it("spawns again after the tracked Ollama process closes", async () => {
        const fetchMock = createFetchMock([false, true, false, true]);
        const { childProcesses, spawnMock } = createSpawnMock();
        await startOllamaIfUnavailable({ fetchImpl: fetchMock, spawnImpl: spawnMock });
        childProcesses[0]?.emit("close", 0, null);
        await startOllamaIfUnavailable({ fetchImpl: fetchMock, spawnImpl: spawnMock });
        expect(spawnMock).toHaveBeenCalledTimes(2);
    });
    it("rejects with the spawn error as the cause when spawning Ollama fails", async () => {
        const fetchMock = createFetchMock([false, false]);
        const spawnError = new Error("spawn ollama ENOENT");
        const { childProcesses, spawnMock } = createSpawnMock();
        const startPromise = startOllamaIfUnavailable({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 100,
            pollIntervalMs: 0,
        });
        await waitForSpawn(childProcesses);
        childProcesses[0]?.emit("error", spawnError);
        await expect(startPromise).rejects.toMatchObject({
            cause: spawnError,
            message: "Failed to start `ollama serve`",
        });
    });
    it("returns false from best-effort startup when spawning Ollama fails", async () => {
        const fetchMock = createFetchMock([false, false]);
        const { childProcesses, spawnMock } = createSpawnMock();
        const startPromise = tryStartOllama({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 100,
            pollIntervalMs: 0,
        });
        await waitForSpawn(childProcesses);
        childProcesses[0]?.emit("error", new Error("spawn ollama ENOENT"));
        await expect(startPromise).resolves.toBe(false);
    });
    it("rejects when Ollama exits before becoming available", async () => {
        const fetchMock = createFetchMock([false, false]);
        const { childProcesses, spawnMock } = createSpawnMock();
        const startPromise = startOllamaIfUnavailable({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 100,
            pollIntervalMs: 0,
        });
        await waitForSpawn(childProcesses);
        childProcesses[0]?.emit("exit", 2, null);
        await expect(startPromise).rejects.toThrow("Ollama process exited before becoming available (code 2)");
    });
});
//# sourceMappingURL=ollamaServer.test.js.map