import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';

// Keep the real cover-letter PDF handler and MongoClient constructor. Other
// handlers must not import providers or perform database/network work here.
const unusedHandler = jest.fn();
const profileHandler =
    jest.fn<(request: Request, response: Response) => Promise<void>>();
jest.unstable_mockModule('#database/createUserProfile.js', () => ({
    default: profileHandler,
}));
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
])
    jest.unstable_mockModule(path, () => ({ default: unusedHandler }));

let server: Server | undefined;

async function startApp(): Promise<string> {
    jest.replaceProperty(process, 'env', {
        MONGODB_CONNECTION_STRING:
            'mongodb://synthetic-private-user/test:synthetic@synthetic.invalid/test',
    });
    let app: typeof import('./app.js').app | undefined;
    await jest.isolateModulesAsync(async () => {
        app = (await import('./app.js')).app;
    });
    server = app!.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

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
    jest.restoreAllMocks();
});

async function expectGenericServerError(
    response: globalThis.Response,
): Promise<void> {
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
        message: 'Unexpected server error',
        error: 'Internal server error',
    });
    for (const detail of [
        'synthetic-private-user',
        'MongoParseError',
        'unescaped',
        '<html',
        'stack',
    ])
        expect(text).not.toContain(detail);
}

describe('app final HTTP error boundary', () => {
    it('sanitizes a real MongoDB constructor rejection before the handler try/catch', async () => {
        const baseUrl = await startApp();

        const response = await fetch(
            `${baseUrl}/cover-letters/synthetic-job-key`,
        );

        await expectGenericServerError(response);
        const logged = jest.mocked(console.error).mock.calls[0]?.[1] as Error;
        expect(logged.name).toBe('MongoParseError');
        expect(logged.message).toContain('synthetic-private-user');
        expect(jest.mocked(console.error).mock.calls[0]?.[0]).toBe(
            'Unexpected server error',
        );
    });

    it('sanitizes an unhandled async rejection and logs the original value', async () => {
        const error = new Error(
            'Synthetic provider failure with private request-id',
        );
        profileHandler.mockRejectedValueOnce(error);
        const baseUrl = await startApp();

        const response = await fetch(`${baseUrl}/users/profile`, {
            method: 'POST',
        });

        await expectGenericServerError(response);
        expect(jest.mocked(console.error).mock.calls[0]?.[1]).toBe(error);
    });

    it.each([
        [400, '{invalid JSON'],
        [413, JSON.stringify({ synthetic: 'x'.repeat(65 * 1024) })],
    ])(
        'preserves a request parser status %i with a fixed public message',
        async (status, body) => {
            const baseUrl = await startApp();

            const response = await fetch(`${baseUrl}/users/profile`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });

            expect(response.status).toBe(status);
            expect(await response.json()).toEqual({
                message: 'Invalid request',
                error: 'Invalid request',
            });
            expect(profileHandler).not.toHaveBeenCalled();
        },
    );
});
