import type { Server } from 'node:http';

import { closeAllTrackedBrowserServers } from '#utils/trackedPlaywrightBrowsers.js';
import { killTokenServiceProcess } from '../tokenService/startTokenService.js';

let activeServer: Server | undefined;
let shutdownHandlersRegistered = false;
let isShuttingDown = false;

export function setActiveServer(server: Server): void {
    activeServer = server;
}

export function hasErrorCode(error: unknown, code: string): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === code
    );
}

export function registerShutdownHandlers(): void {
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
            killTokenServiceProcess();

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
        killTokenServiceProcess();
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
