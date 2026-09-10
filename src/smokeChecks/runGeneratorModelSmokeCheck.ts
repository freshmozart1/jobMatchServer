import type { ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses';
import type { ReasoningEffort } from 'openai/resources/shared';

export type SmokeCheckOutcome = {
    status: 'passed' | 'skipped' | 'failed';
    message: string;
};

// Only the fields the check reads. The SDK's `Response` is assignable to this
// without a cast, and tests can hand in plain objects.
type SmokeCheckResponse = {
    status?: string | undefined;
    incomplete_details?: { reason?: string | undefined } | null | undefined;
    error?:
        | {
              code?: string | null | undefined;
              message?: string | null | undefined;
          }
        | null
        | undefined;
};

type SmokeCheckOptions = {
    apiKey: string | undefined;
    model: string;
    reasoningEffort: ReasoningEffort;
    skipOnUnauthorized: boolean;
    createResponse: (
        apiKey: string,
        request: ResponseCreateParamsNonStreaming,
    ) => Promise<SmokeCheckResponse>;
};

const ANNOTATION_TITLE = 'Generator model smoke check';
const UNKNOWN_ERROR_MESSAGE = 'Unknown error';

function buildRequest(
    model: string,
    reasoningEffort: ReasoningEffort,
): ResponseCreateParamsNonStreaming {
    return {
        model,
        reasoning: { effort: reasoningEffort },
        input: 'Reply with {"ok":true}.',
        // Caps the billed reasoning tokens. Running out of this budget during
        // `high` reasoning is expected and still proves the request was accepted.
        max_output_tokens: 256,
        // Mirrors the package's call shape, so "structured outputs unsupported
        // for this model" is caught alongside a rejected model or effort.
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
    };
}

// Reads one field off a rejection value without trusting its shape: a
// non-object has no fields, and a throwing getter reads as absent.
function readField(value: unknown, field: string): unknown {
    if (typeof value !== 'object' || value === null) return undefined;
    try {
        return (value as Record<string, unknown>)[field];
    } catch {
        return undefined;
    }
}

// Mirrors describeFailureReason() in src/scrapers/linkedin/scrapeJob.ts, which
// isn't imported because that module pulls in the whole scraper stack. Each
// fallback matters: `new Error().message` is `''`; a `{ message }` object fails
// `instanceof` yet carries a real message; and `String()` throws on a value
// whose `toString` throws or is missing. Only a message is ever returned, never
// a serialized error object.
function describeErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name || UNKNOWN_ERROR_MESSAGE;
    }
    const message = readField(error, 'message');
    if (typeof message === 'string' && message.length > 0) return message;
    try {
        return String(error) || UNKNOWN_ERROR_MESSAGE;
    } catch {
        return UNKNOWN_ERROR_MESSAGE;
    }
}

function classifyResponse(
    response: SmokeCheckResponse,
    checked: string,
): SmokeCheckOutcome {
    switch (response.status) {
        case 'completed':
            return {
                status: 'passed',
                message: `Passed: ${checked} completed the request.`,
            };
        case 'incomplete':
            return {
                status: 'passed',
                message: `Passed: ${checked} accepted the request; the response stopped early (incomplete: ${response.incomplete_details?.reason ?? 'unknown reason'}), which does not matter for this check.`,
            };
        case 'failed':
            return {
                status: 'failed',
                message: `Failed: ${checked} returned status "failed" (${response.error?.code ?? 'no error code'}: ${response.error?.message ?? 'no error message'}).`,
            };
        default:
            return {
                status: 'failed',
                message: `Failed: ${checked} returned an unexpected status (${response.status ?? 'none'}).`,
            };
    }
}

// Classified by shape rather than `instanceof`, so any error-like value with a
// `status`/`code`/`param` is read the same way as the SDK's own APIError.
function classifyRejection(
    error: unknown,
    checked: string,
    skipOnUnauthorized: boolean,
): SmokeCheckOutcome {
    const httpStatus = readField(error, 'status');
    if (httpStatus === 401) {
        // The provider's message is left out on purpose: OpenAI's 401 text
        // echoes part of the key it rejected.
        return skipOnUnauthorized
            ? {
                  status: 'skipped',
                  message: `Skipped: OPENAI_API_KEY was rejected (401), so ${checked} was not checked.`,
              }
            : {
                  status: 'failed',
                  message: `Failed: OPENAI_API_KEY was rejected (401), so ${checked} could not be checked.`,
              };
    }
    const details: string[] = [];
    if (typeof httpStatus === 'number') details.push(`HTTP ${httpStatus}`);
    const code = readField(error, 'code');
    if (typeof code === 'string' && code.length > 0) {
        details.push(`code ${code}`);
    }
    const param = readField(error, 'param');
    if (typeof param === 'string' && param.length > 0) {
        details.push(`param ${param}`);
    }
    const detailText = details.length > 0 ? ` (${details.join(', ')})` : '';
    return {
        status: 'failed',
        message: `Failed: the request for ${checked} errored${detailText}: ${describeErrorMessage(error)}`,
    };
}

export async function runGeneratorModelSmokeCheck(
    options: SmokeCheckOptions,
): Promise<SmokeCheckOutcome> {
    const {
        apiKey,
        model,
        reasoningEffort,
        skipOnUnauthorized,
        createResponse,
    } = options;
    const checked = `${model} with reasoning.effort "${reasoningEffort}"`;
    if (apiKey === undefined || apiKey.trim() === '') {
        return {
            status: 'skipped',
            message: `Skipped: OPENAI_API_KEY is not set, so ${checked} was not checked.`,
        };
    }
    let response: SmokeCheckResponse;
    try {
        response = await createResponse(
            apiKey,
            buildRequest(model, reasoningEffort),
        );
    } catch (error) {
        return classifyRejection(error, checked, skipOnUnauthorized);
    }
    return classifyResponse(response, checked);
}

// GitHub Actions workflow-command data escaping; `%` must be escaped first so
// the escapes added for `\r` and `\n` aren't escaped again.
function escapeAnnotationData(data: string): string {
    return data
        .replaceAll('%', '%25')
        .replaceAll('\r', '%0D')
        .replaceAll('\n', '%0A');
}

export function formatOutcome(
    outcome: SmokeCheckOutcome,
    githubActions: boolean,
): string {
    if (!githubActions || outcome.status === 'passed') return outcome.message;
    const command = outcome.status === 'skipped' ? 'notice' : 'error';
    return `::${command} title=${ANNOTATION_TITLE}::${escapeAnnotationData(outcome.message)}`;
}
