import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import createResponse from '../testHelpers/createResponse.test.js';
import { createErrorMessage } from './createErrorMessage.js';

describe('createErrorMessage public error boundary', () => {
    beforeEach(() => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        new Error(
            'Synthetic OpenAI quota for org-private; request req-private',
        ),
        'Synthetic MongoDB host cluster.private.invalid refused connection',
        { message: 'Synthetic provider details', requestId: 'private-request' },
        Object.create(null) as unknown,
        undefined,
    ])('keeps the original rejection only in server logs (%p)', (error) => {
        const { response, status, json } = createResponse();

        createErrorMessage(response, error, 'Operation failed');

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            message: 'Operation failed',
            error: 'Internal server error',
        });
        expect(console.error).toHaveBeenCalledWith('Operation failed', error);
    });

    it('never reads or coerces a caught error with throwing accessors', () => {
        const error = new Error();
        const message = jest.fn(() => {
            throw new Error('message getter called');
        });
        const toString = jest.fn(() => {
            throw new Error('toString called');
        });
        Object.defineProperty(error, 'message', { get: message });
        error.toString = toString;
        const { response, json } = createResponse();

        expect(() =>
            createErrorMessage(response, error, 'Operation failed'),
        ).not.toThrow();

        expect(json).toHaveBeenCalledWith({
            message: 'Operation failed',
            error: 'Internal server error',
        });
        expect(message).not.toHaveBeenCalled();
        expect(toString).not.toHaveBeenCalled();
        expect(jest.mocked(console.error).mock.calls[0]?.[0]).toBe(
            'Operation failed',
        );
        expect(jest.mocked(console.error).mock.calls[0]?.[1]).toBe(error);
    });

    it.each([
        [400, 'Invalid request body'],
        [400, ''],
        [404, 'Job not found'],
        [422, 'Shorten the cover letter'],
        [500, 'Invalid file path'],
        [504, 'Request deadline exceeded'],
    ] as const)(
        'preserves an explicitly curated public error with status %i',
        (code, publicError) => {
            const error = new Error('Synthetic internal details');
            const { response, status, json } = createResponse();

            createErrorMessage(
                response,
                error,
                'Operation failed',
                code,
                publicError,
            );

            expect(status).toHaveBeenCalledWith(code);
            expect(json).toHaveBeenCalledWith({
                message: 'Operation failed',
                error: publicError,
            });
            expect(console.error).toHaveBeenCalledWith(
                'Operation failed',
                error,
            );
        },
    );
});
