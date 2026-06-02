import { beforeEach, describe, expect, it, jest } from "@jest/globals";
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
function createSpawnMock() {
    const childProcess = {
        killed: false,
        unref: jest.fn(),
    };
    const spawnMock = jest.fn();
    spawnMock.mockReturnValue(childProcess);
    return spawnMock;
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
        const spawnMock = createSpawnMock();
        await startOllamaIfUnavailable({ fetchImpl: fetchMock, spawnImpl: spawnMock });
        expect(spawnMock).not.toHaveBeenCalled();
    });
    it("spawns Ollama when unavailable and waits until it responds", async () => {
        const fetchMock = createFetchMock([false, false, true]);
        const spawnMock = createSpawnMock();
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
        const spawnMock = createSpawnMock();
        await expect(startOllamaIfUnavailable({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 0,
            pollIntervalMs: 0,
        })).rejects.toThrow("Ollama did not become available after starting `ollama serve`");
    });
    it("returns true from best-effort startup when Ollama is already available", async () => {
        const fetchMock = createFetchMock([true]);
        const spawnMock = createSpawnMock();
        await expect(tryStartOllama({ fetchImpl: fetchMock, spawnImpl: spawnMock })).resolves.toBe(true);
        expect(spawnMock).not.toHaveBeenCalled();
    });
    it("returns true from best-effort startup after spawning Ollama successfully", async () => {
        const fetchMock = createFetchMock([false, false, true]);
        const spawnMock = createSpawnMock();
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
        const spawnMock = createSpawnMock();
        await expect(tryStartOllama({
            fetchImpl: fetchMock,
            spawnImpl: spawnMock,
            startupTimeoutMs: 0,
            pollIntervalMs: 0,
        })).resolves.toBe(false);
    });
});
//# sourceMappingURL=ollamaServer.test.js.map