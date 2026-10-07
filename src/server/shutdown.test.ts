import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Server } from 'node:http';

const killTokenServiceProcess = jest.fn();
const listeners = new Map<string | symbol, (...args: unknown[]) => void>();
const exitListeners = new Map<string | symbol, (...args: unknown[]) => void>();
const processExit = new Error('Synthetic process exit');
let shutdown: typeof import('./shutdown.js');

jest.unstable_mockModule('../tokenService/startTokenService.js', () => ({
    killTokenServiceProcess,
}));

function signal(signalName: NodeJS.Signals): void {
    const listener = listeners.get(signalName);
    expect(listener).toBeDefined();
    listener!(signalName);
}

describe('server shutdown', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        listeners.clear();
        exitListeners.clear();
        jest.spyOn(process, 'on').mockImplementation((event, listener) => {
            listeners.set(event, listener);
            return process;
        });
        jest.spyOn(process, 'once').mockImplementation((event, listener) => {
            exitListeners.set(event, listener);
            return process;
        });
        jest.spyOn(process, 'exit').mockImplementation(() => {
            throw processExit;
        });
        jest.spyOn(process, 'kill').mockReturnValue(true);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await jest.isolateModulesAsync(async () => {
            shutdown = await import('./shutdown.js');
        });
        shutdown.registerShutdownHandlers();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('registers persistent signal handlers and the exit fallback once', () => {
        shutdown.registerShutdownHandlers();

        expect(process.on).toHaveBeenCalledTimes(3);
        expect([...listeners.keys()]).toEqual(['SIGINT', 'SIGTERM', 'SIGUSR2']);
        expect(process.once).toHaveBeenCalledTimes(1);
        expect([...exitListeners.keys()]).toEqual(['exit']);
    });

    it('kills the token service before exiting when no listener is active', () => {
        expect(() => signal('SIGINT')).toThrow(processExit);

        expect(killTokenServiceProcess).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
        expect(killTokenServiceProcess.mock.invocationCallOrder[0]).toBeLessThan(
            jest.mocked(process.exit).mock.invocationCallOrder[0]!,
        );
    });

    it('kills the token service and waits for the HTTP listener to close', () => {
        const close = jest.fn<Server['close']>();
        const server = { close } as unknown as Server;
        close.mockReturnValue(server);
        shutdown.setActiveServer(server);

        signal('SIGTERM');

        expect(killTokenServiceProcess).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(killTokenServiceProcess.mock.invocationCallOrder[0]).toBeLessThan(
            close.mock.invocationCallOrder[0]!,
        );
        expect(process.exit).not.toHaveBeenCalled();

        expect(() => close.mock.calls[0]![0]!()).toThrow(processExit);
        expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('reports listener-close failures and exits unsuccessfully', () => {
        const close = jest.fn<Server['close']>();
        const server = { close } as unknown as Server;
        close.mockReturnValue(server);
        shutdown.setActiveServer(server);
        const error = new Error('Synthetic listener close failure');

        signal('SIGINT');

        expect(() => close.mock.calls[0]![0]!(error)).toThrow(processExit);
        expect(console.error).toHaveBeenCalledWith(error);
        expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('forces an unsuccessful exit when another signal interrupts draining', () => {
        const close = jest.fn<Server['close']>();
        const server = { close } as unknown as Server;
        close.mockReturnValue(server);
        shutdown.setActiveServer(server);

        signal('SIGINT');
        expect(() => signal('SIGTERM')).toThrow(processExit);

        expect(process.exit).toHaveBeenCalledWith(1);
        expect(killTokenServiceProcess).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('routes nodemon restarts through the SIGTERM cleanup handler', () => {
        signal('SIGUSR2');

        expect(process.kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
        expect(killTokenServiceProcess).not.toHaveBeenCalled();

        expect(() => signal('SIGTERM')).toThrow(processExit);
        expect(killTokenServiceProcess).toHaveBeenCalledTimes(1);
        expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('kills the token service on process exit without issuing another exit', () => {
        exitListeners.get('exit')!(0);

        expect(killTokenServiceProcess).toHaveBeenCalledTimes(1);
        expect(process.exit).not.toHaveBeenCalled();
    });
});
