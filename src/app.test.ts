import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// Keep the real app, Express middleware and HTTP transport; unrelated routes
// must never load their database/provider/scraper modules for these tests.
const unusedHandler = jest.fn();
jest.unstable_mockModule('#scrapers/linkedin/scrapeJob.js', () => ({
    scrapeJob: unusedHandler,
}));
for (const path of [
    '#database/createJobInDatabase.js',
    '#database/uploadCoverLetterAsText.js',
    './coverLetters/generateCoverLettersAsText.js',
    './coverLetters/reviseCoverLetterAsText.js',
    './tokens/calculateTokens.js',
    '#database/uploadCV.js',
    '#database/getCV.js',
    '#database/getCVStatus.js',
    '#database/uploadCertificates.js',
    '#database/getCertificatesStatus.js',
    '#database/getApplication.js',
    '#database/getCoverLetterPdf.js',
]) {
    jest.unstable_mockModule(path, () => ({ default: unusedHandler }));
}

let server: Server | undefined;

async function loadApp(configuredOrigins?: string) {
    jest.replaceProperty(
        process,
        'env',
        configuredOrigins === undefined
            ? {}
            : { CORS_ALLOWED_ORIGINS: configuredOrigins },
    );
    let app: typeof import('./app.js').app | undefined;
    await jest.isolateModulesAsync(async () => {
        app = (await import('./app.js')).app;
    });
    return app!;
}

async function startApp(configuredOrigins?: string): Promise<string> {
    const app = await loadApp(configuredOrigins);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
    if (server?.listening) {
        const active = server;
        server = undefined;
        const closed = new Promise<void>((resolve, reject) => {
            active.close((error) => (error ? reject(error) : resolve()));
        });
        active.closeAllConnections();
        await closed;
    }
    expect(unusedHandler).not.toHaveBeenCalled();
    jest.clearAllMocks();
    jest.restoreAllMocks();
});

async function expectAllowed(baseUrl: string, origin: string): Promise<void> {
    const response = await fetch(`${baseUrl}/health`, {
        headers: { Origin: origin },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Vary')).toBe('Origin');
    expect(await response.json()).toEqual({ status: 'ok' });

    const preflight = await fetch(`${baseUrl}/scrape/linkedin`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'Content-Type',
        },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET,POST,OPTIONS',
    );
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe(
        'Content-Type',
    );
    expect(preflight.headers.get('Vary')).toBe('Origin');
}

describe('app CORS policy', () => {
    it.each([
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
        'http://127.0.0.1:4173',
        'http://192.168.1.10:5173',
    ])('allows development or preview origin %s', async (origin) => {
        await expectAllowed(await startApp(), origin);
    });

    it.each([
        'https://jobs.review.invalid',
        'https://jobs.review.invalid:8443',
        'http://10.0.0.10:5173',
        'http://172.16.0.10:4173',
    ])(
        'allows explicitly configured origin %s without removing defaults',
        async (origin) => {
            const baseUrl = await startApp(
                ` https://other.review.invalid , ${origin} `,
            );
            await expectAllowed(baseUrl, origin);
            await expectAllowed(baseUrl, 'http://localhost:4173');
        },
    );

    it.each([
        'https://unconfigured.review.invalid',
        'http://10.0.0.10:5173',
        'http://localhost:5174',
        'http://192.168.1.10:4173',
        'http://192.168.1.10.attacker.invalid:5173',
        'http://192.168.999.999:5173',
        'null',
    ])('does not authorize an unconfigured origin %s', async (origin) => {
        const baseUrl = await startApp();
        for (const method of ['GET', 'OPTIONS']) {
            const response = await fetch(`${baseUrl}/health`, {
                method,
                headers: { Origin: origin },
            });
            expect(response.status).toBe(method === 'GET' ? 200 : 204);
            expect(
                response.headers.get('Access-Control-Allow-Origin'),
            ).toBeNull();
            expect(response.headers.get('Vary')).toBe('Origin');
            await response.text();
        }
    });

    it('serves same-origin/no-Origin health requests without an allow-origin header', async () => {
        const response = await fetch(`${await startApp()}/health`);
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
        expect(response.headers.get('Vary')).toBe('Origin');
        expect(await response.json()).toEqual({ status: 'ok' });
    });

    it('keeps defaults when configuration is blank', async () => {
        await expectAllowed(await startApp('  '), 'http://localhost:4173');
    });

    it.each([
        '*',
        'null',
        'https://*.review.invalid',
        'https://synthetic-user:synthetic-password@review.invalid',
        'https://review.invalid/path',
        'https://review.invalid/',
        'https://review.invalid?token=synthetic-secret',
        'https://review.invalid#fragment',
        'ftp://review.invalid',
        'https://review.invalid,',
        'https://review.invalid,,https://other.review.invalid',
        'not a URL',
        'https://review.invalid:99999',
        'https://review.invalid:443',
    ])(
        'rejects invalid CORS configuration %s during app initialization',
        async (configuredOrigins) => {
            await expect(loadApp(configuredOrigins)).rejects.toThrow(
                /Invalid CORS_ALLOWED_ORIGINS entry \d+/,
            );
        },
    );

    it('reports the invalid entry index without echoing credentials', async () => {
        await expect(
            loadApp(
                'https://safe.review.invalid,https://synthetic-user:synthetic-password@review.invalid',
            ),
        ).rejects.toMatchObject({
            message:
                'Invalid CORS_ALLOWED_ORIGINS entry 2: expected an exact HTTP(S) origin without credentials, paths, query, fragments, or wildcards.',
        });
    });
});
