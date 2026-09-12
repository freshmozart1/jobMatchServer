import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import { DeadlineExceededError, withDeadline } from './withDeadline.js';

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('withDeadline', () => {
    it('rejects with a typed error when the deadline expires', async () => {
        const operation = jest.fn<() => Promise<void>>(
            () => new Promise(() => undefined),
        );
        const result = withDeadline(operation, 1_000);
        const rejection = expect(result).rejects.toEqual(
            new DeadlineExceededError(1_000),
        );

        await jest.advanceTimersByTimeAsync(1_000);

        await rejection;
        expect(operation).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('returns a successful result and clears the pending timer', async () => {
        await expect(
            withDeadline(() => Promise.resolve('done'), 1_000),
        ).resolves.toBe('done');

        expect(jest.getTimerCount()).toBe(0);
    });

    it('preserves an operation rejection and clears the pending timer', async () => {
        const error = new Error('operation failed');

        await expect(
            withDeadline(() => Promise.reject(error), 1_000),
        ).rejects.toBe(error);

        expect(jest.getTimerCount()).toBe(0);
    });
});
