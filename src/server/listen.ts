import type { Server } from 'node:http';

import { app } from '../app.js';
import {
    TOKEN_SERVICE_URL_ENV,
    ensureTokenServiceStarted,
} from '../tokenService/startTokenService.js';
import {
    hasErrorCode,
    registerShutdownHandlers,
    setActiveServer,
} from './shutdown.js';

export async function listenWithFallback(
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
                setActiveServer(server);
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
