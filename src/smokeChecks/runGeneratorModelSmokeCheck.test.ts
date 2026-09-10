import { describe, expect, it, jest } from '@jest/globals';
import type { SmokeCheckOutcome } from './runGeneratorModelSmokeCheck.js';
import {
    formatOutcome,
    runGeneratorModelSmokeCheck,
} from './runGeneratorModelSmokeCheck.js';

type SmokeCheckOptions = Parameters<typeof runGeneratorModelSmokeCheck>[0];
type CreateResponse = SmokeCheckOptions['createResponse'];
type SmokeCheckResponse = Awaited<ReturnType<CreateResponse>>;

const API_KEY = 'sk-test-key';
const MODEL = 'gpt-test-model';
const REASONING_EFFORT = 'medium';
const PROVIDER_401_MESSAGE = 'Incorrect API key provided: sk-...abcd';
const ANNOTATION_PREFIX = 'title=Generator model smoke check::';

function resolvingWith(response: SmokeCheckResponse) {
    return jest.fn<CreateResponse>().mockResolvedValue(response);
}

function rejectingWith(reason: unknown) {
    return jest.fn<CreateResponse>().mockRejectedValue(reason);
}

async function runCheck(
    createResponse: CreateResponse,
    overrides: Partial<Omit<SmokeCheckOptions, 'createResponse'>> = {},
): Promise<SmokeCheckOutcome> {
    const outcome = await runGeneratorModelSmokeCheck({
        apiKey: API_KEY,
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        skipOnUnauthorized: false,
        ...overrides,
        createResponse,
    });
    // Every outcome names what was checked.
    expect(outcome.message).toContain(MODEL);
    expect(outcome.message).toContain(REASONING_EFFORT);
    return outcome;
}

function unauthorizedError(): Error {
    return Object.assign(new Error(`401 ${PROVIDER_401_MESSAGE}`), {
        status: 401,
        code: 'invalid_api_key',
        param: null,
    });
}

describe('runGeneratorModelSmokeCheck', () => {
    it('skips without calling the API when OPENAI_API_KEY is missing', async () => {
        const createResponse = resolvingWith({ status: 'completed' });

        const outcome = await runCheck(createResponse, { apiKey: undefined });

        expect(outcome.status).toBe('skipped');
        expect(outcome.message).toContain('OPENAI_API_KEY is not set');
        expect(createResponse).not.toHaveBeenCalled();
    });

    it('skips without calling the API when OPENAI_API_KEY is blank', async () => {
        const createResponse = resolvingWith({ status: 'completed' });

        const outcome = await runCheck(createResponse, { apiKey: ' \t\n' });

        expect(outcome.status).toBe('skipped');
        expect(outcome.message).toContain('OPENAI_API_KEY is not set');
        expect(createResponse).not.toHaveBeenCalled();
    });

    it('sends a minimal structured-output request for the given model and effort', async () => {
        const createResponse = resolvingWith({ status: 'completed' });

        await runCheck(createResponse);

        expect(createResponse).toHaveBeenCalledTimes(1);
        expect(createResponse).toHaveBeenCalledWith(API_KEY, {
            model: MODEL,
            reasoning: { effort: REASONING_EFFORT },
            input: 'Reply with {"ok":true}.',
            max_output_tokens: 256,
            text: {
                format: {
                    type: 'json_schema',
                    name: 'smoke_check',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: { ok: { type: 'boolean' } },
                        required: ['ok'],
                        additionalProperties: false,
                    },
                },
            },
            store: false,
        });
    });

    it('passes when the response completes', async () => {
        const outcome = await runCheck(
            resolvingWith({
                status: 'completed',
                error: null,
                incomplete_details: null,
            }),
        );

        expect(outcome.status).toBe('passed');
    });

    it('passes an incomplete response, since the request was accepted, and names the reason', async () => {
        const outcome = await runCheck(
            resolvingWith({
                status: 'incomplete',
                error: null,
                incomplete_details: { reason: 'max_output_tokens' },
            }),
        );

        expect(outcome.status).toBe('passed');
        expect(outcome.message).toContain('max_output_tokens');
    });

    it('fails a failed response with its error code and message', async () => {
        const outcome = await runCheck(
            resolvingWith({
                status: 'failed',
                error: {
                    code: 'server_error',
                    message: 'The server had an error.',
                },
                incomplete_details: null,
            }),
        );

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('server_error');
        expect(outcome.message).toContain('The server had an error.');
    });

    it('fails a response with an unexpected status', async () => {
        const outcome = await runCheck(resolvingWith({ status: 'cancelled' }));

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('cancelled');
    });

    it('skips a 401 when skipOnUnauthorized is set, without echoing the provider message', async () => {
        const outcome = await runCheck(rejectingWith(unauthorizedError()), {
            skipOnUnauthorized: true,
        });

        expect(outcome.status).toBe('skipped');
        expect(outcome.message).toContain('401');
        expect(outcome.message).not.toContain(PROVIDER_401_MESSAGE);
        expect(outcome.message).not.toContain('sk-...abcd');
    });

    it('fails a 401 when skipOnUnauthorized is not set, without echoing the provider message', async () => {
        const outcome = await runCheck(rejectingWith(unauthorizedError()), {
            skipOnUnauthorized: false,
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('401');
        expect(outcome.message).not.toContain(PROVIDER_401_MESSAGE);
        expect(outcome.message).not.toContain('sk-...abcd');
    });

    it('fails an unavailable model with its HTTP status, code, and message', async () => {
        const modelNotFound = Object.assign(
            new Error('The model does not exist or you do not have access.'),
            { status: 404, code: 'model_not_found', param: null },
        );

        const outcome = await runCheck(rejectingWith(modelNotFound));

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('HTTP 404');
        expect(outcome.message).toContain('code model_not_found');
        expect(outcome.message).toContain(
            'The model does not exist or you do not have access.',
        );
    });

    it('fails a rejected parameter and names the parameter', async () => {
        // A plain error-like object, not an Error: classification is by shape.
        const unsupportedParameter = {
            status: 400,
            code: 'unsupported_parameter',
            param: 'reasoning.effort',
            message: 'Unsupported parameter for this model.',
        };

        const outcome = await runCheck(rejectingWith(unsupportedParameter));

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('HTTP 400');
        expect(outcome.message).toContain('code unsupported_parameter');
        expect(outcome.message).toContain('param reasoning.effort');
        expect(outcome.message).toContain(
            'Unsupported parameter for this model.',
        );
    });

    it('fails a string rejection without throwing', async () => {
        const outcome = await runCheck(rejectingWith('socket hang up'));

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('socket hang up');
    });

    it('fails a rejection whose toString throws without throwing', async () => {
        const unprintable = {
            toString(): string {
                throw new Error('toString exploded');
            },
        };

        const outcome = await runCheck(rejectingWith(unprintable));

        expect(outcome.status).toBe('failed');
        expect(outcome.message).toContain('Unknown error');
        expect(outcome.message).not.toContain('toString exploded');
    });
});

describe('formatOutcome', () => {
    it('renders the plain, unescaped message outside GitHub Actions', () => {
        expect(
            formatOutcome(
                { status: 'failed', message: 'Failed: 50%\nbroken' },
                false,
            ),
        ).toBe('Failed: 50%\nbroken');
        expect(
            formatOutcome(
                { status: 'skipped', message: 'Skipped: no key' },
                false,
            ),
        ).toBe('Skipped: no key');
    });

    it('renders a skipped outcome as a notice annotation under GitHub Actions', () => {
        expect(
            formatOutcome(
                { status: 'skipped', message: 'Skipped: no key' },
                true,
            ),
        ).toBe(`::notice ${ANNOTATION_PREFIX}Skipped: no key`);
    });

    it('renders a failed outcome as an error annotation under GitHub Actions', () => {
        expect(
            formatOutcome({ status: 'failed', message: 'Failed: 404' }, true),
        ).toBe(`::error ${ANNOTATION_PREFIX}Failed: 404`);
    });

    it('renders a passed outcome as a plain line under GitHub Actions', () => {
        expect(
            formatOutcome({ status: 'passed', message: 'Passed: ok' }, true),
        ).toBe('Passed: ok');
    });

    it('escapes %, carriage returns, and newlines in annotation data, % first', () => {
        expect(
            formatOutcome({ status: 'failed', message: '50%\r\n%0A' }, true),
        ).toBe(`::error ${ANNOTATION_PREFIX}50%25%0D%0A%250A`);
    });
});
