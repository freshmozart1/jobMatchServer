import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Server } from 'node:http';

const listenWithFallback =
    jest.fn<typeof import('./server/listen.js').listenWithFallback>();
const killTokenServiceProcess = jest.fn();
const output: string[] = [];
const secrets = {
    username: 'synthetic-startup-user',
    password: 'synthetic-startup-password',
    query: 'synthetic-startup-query-secret',
};
const connectionUri =
    `mongodb://${secrets.username}:${secrets.password}@review.invalid/jobMatch` +
    `?authMechanismProperties=AWS_SESSION_TOKEN%3A${secrets.query}`;

jest.unstable_mockModule('./server/listen.js', () => ({ listenWithFallback }));
jest.unstable_mockModule('./tokenService/startTokenService.js', () => ({
    killTokenServiceProcess,
}));

function expectNoConnectionSecrets(): void {
    const capturedOutput = output.join('\n');
    for (const secret of [connectionUri, ...Object.values(secrets)]) {
        expect(capturedOutput).not.toContain(secret);
    }
}

describe('server entrypoint', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        output.length = 0;
        // Replace the entire environment so this test never reads real credentials.
        jest.replaceProperty(process, 'env', {
            MONGODB_CONNECTION_STRING: connectionUri,
        });
        for (const method of [
            'log',
            'info',
            'warn',
            'error',
            'debug',
        ] as const) {
            jest.spyOn(console, method).mockImplementation(
                (...args: unknown[]) => {
                    output.push(args.map(String).join(' '));
                },
            );
        }
        jest.spyOn(process, 'exit').mockReturnValue(undefined as never);
        listenWithFallback.mockResolvedValue({} as Server);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('starts the listener at port3000 without logging MongoDB connection secrets', async () => {
        await jest.isolateModulesAsync(async () => {
            await import('./index.js');
        });

        expect(listenWithFallback).toHaveBeenCalledTimes(1);
        expect(listenWithFallback).toHaveBeenCalledWith(3000);
        expect(killTokenServiceProcess).not.toHaveBeenCalled();
        expect(process.exit).not.toHaveBeenCalled();
        expectNoConnectionSecrets();
    });

    it('preserves fatal startup reporting, cleanup and exit without logging connection secrets', async () => {
        const startupError = new Error('Synthetic listener failure');
        listenWithFallback.mockRejectedValue(startupError);

        await jest.isolateModulesAsync(async () => {
            await import('./index.js');
        });

        expect(listenWithFallback).toHaveBeenCalledWith(3000);
        expect(console.error).toHaveBeenCalledWith(startupError);
        expect(killTokenServiceProcess).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(1);
        expect(
            killTokenServiceProcess.mock.invocationCallOrder[0],
        ).toBeLessThan(jest.mocked(process.exit).mock.invocationCallOrder[0]!);
        expectNoConnectionSecrets();
    });
});
