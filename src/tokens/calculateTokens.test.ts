import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { CalculateTokensRequestBody } from '#types';
import createRequest from '../testHelpers/createRequest.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import countTokens from './calculateTokens.js';

describe('countTokens response privacy', () => {
    beforeEach(() => {
        jest.replaceProperty(process, 'env', {
            TOKEN_SERVICE_URL: 'http://synthetic-sidecar.invalid',
        });
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    function request() {
        return createRequest<CalculateTokensRequestBody>({
            body: { text: 'Synthetic text', model: 'synthetic-model' },
        });
    }

    it.each([
        new Error(
            'Synthetic connection failed at private-host.invalid with private-token',
        ),
        'Synthetic connection details with private-token',
        { message: 'Synthetic private request details' },
        Object.create(null) as unknown,
    ])(
        'keeps connection rejection details only in the server log (%p)',
        async (error) => {
            jest.mocked(fetch).mockRejectedValue(error);
            const { response, status, json } = createResponse();

            await countTokens(request(), response);

            expect(status).toHaveBeenCalledWith(500);
            expect(json).toHaveBeenCalledWith({
                error: 'Error connecting to token service.',
                details: 'Internal server error',
            });
            expect(jest.mocked(console.error).mock.calls[0]?.[1]).toBe(error);
        },
    );

    it('never reads or coerces a rejection with throwing accessors', async () => {
        const error = new Error();
        const getter = jest.fn(() => {
            throw new Error('message getter invoked');
        });
        const toString = jest.fn(() => {
            throw new Error('toString invoked');
        });
        Object.defineProperty(error, 'message', { get: getter });
        error.toString = toString;
        jest.mocked(fetch).mockRejectedValue(error);
        const { response, status, json } = createResponse();

        await expect(countTokens(request(), response)).resolves.toBeUndefined();

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            error: 'Error connecting to token service.',
            details: 'Internal server error',
        });
        expect(getter).not.toHaveBeenCalled();
        expect(toString).not.toHaveBeenCalled();
        expect(jest.mocked(console.error).mock.calls[0]?.[1]).toBe(error);
    });

    it('preserves the successful token count response and forwards the request', async () => {
        jest.mocked(fetch).mockResolvedValue(
            new globalThis.Response('33', { status: 200 }),
        );
        const { response, status, json } = createResponse();

        await countTokens(request(), response);

        expect(fetch).toHaveBeenCalledWith(
            'http://synthetic-sidecar.invalid/count',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: 'Synthetic text',
                    model: 'synthetic-model',
                }),
            },
        );
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ tokenCount: 33 });
    });

    it('preserves a non-ok token service response without returning its body', async () => {
        jest.mocked(fetch).mockResolvedValue(
            new globalThis.Response('Synthetic private service detail', {
                status: 503,
            }),
        );
        const { response, status, json } = createResponse();

        await countTokens(request(), response);

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            error: 'Failed to calculate tokens.',
        });
    });
});
