import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Request } from 'express';
import createResponse from '../testHelpers/createResponse.test.js';
import handleUnhandledError from './errorHandler.js';

describe('unhandled HTTP error boundary', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('delegates the original error after headers are sent without writing another body', () => {
        const error = new Error('Synthetic stream failure');
        const { response, status, json } = createResponse();
        Object.defineProperty(response, 'headersSent', { value: true });
        const next = jest.fn();

        handleUnhandledError(error, {} as Request, response, next);

        expect(next).toHaveBeenCalledWith(error);
        expect(status).not.toHaveBeenCalled();
        expect(json).not.toHaveBeenCalled();
    });

    it('preserves an inherited request-parser status without exposing its message', () => {
        const error = Object.create({ status: 413 }) as unknown;
        const { response, status, json } = createResponse();

        handleUnhandledError(error, {} as Request, response, jest.fn());

        expect(status).toHaveBeenCalledWith(413);
        expect(json).toHaveBeenCalledWith({
            message: 'Invalid request',
            error: 'Invalid request',
        });
    });

    it('does not invoke throwing accessors on unhandled errors', () => {
        const error = new Error();
        const getter = jest.fn(() => {
            throw new Error('Getter must not be invoked');
        });
        Object.defineProperty(error, 'message', { get: getter });
        Object.defineProperty(error, 'status', { get: getter });
        const { response, status, json } = createResponse();
        const next = jest.fn();

        expect(() =>
            handleUnhandledError(error, {} as Request, response, next),
        ).not.toThrow();

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            message: 'Unexpected server error',
            error: 'Internal server error',
        });
        expect(getter).not.toHaveBeenCalled();
        expect(jest.mocked(console.error).mock.calls[0]?.[1]).toBe(error);
        expect(next).not.toHaveBeenCalled();
    });
});
