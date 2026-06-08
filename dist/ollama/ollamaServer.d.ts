import type { ChildProcess } from "node:child_process";
import type { Response } from "express";
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
export declare function sendOllamaUnavailableResponse(response: Response): void;
export declare function isOllamaAvailable(fetchImpl?: FetchLike): Promise<boolean>;
export declare function startOllamaIfUnavailable(options?: StartOllamaOptions): Promise<void>;
export declare function tryStartOllama(options?: StartOllamaOptions): Promise<boolean>;
export declare function clearTrackedOllamaProcess(): void;
export {};
//# sourceMappingURL=ollamaServer.d.ts.map