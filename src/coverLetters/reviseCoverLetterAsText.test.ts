import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { ReviseCoverLetterAsTextRequestBody } from '#types';
import {
    mockCoverLetterGeneratorModule,
    reviseCoverLetterText,
} from '../testMockModules/coverLetterGenerator.test.js';
import {
    getCollection,
    mockLocalDatabaseModule,
} from '../testMockModules/localDatabase.test.js';
import createRequest from '../testHelpers/createRequest.test.js';
import createResponse from '../testHelpers/createResponse.test.js';

mockCoverLetterGeneratorModule();
mockLocalDatabaseModule();

const {
    default: reviseCoverLetterAsText,
    isValidReviseCoverLetterAsTextRequestBody,
    REVISE_COVER_LETTER_DEADLINE_MS,
} = await import('./reviseCoverLetterAsText.js');

const validBody: ReviseCoverLetterAsTextRequestBody = {
    selectedText: 'I am very interested in this role.',
    instruction: 'Make this more specific and confident.',
    coverLetterText:
        'Dear Hiring Manager,\n\nI am very interested in this role.\n\nKind regards',
    job: {
        title: 'Software Engineer',
        company: 'Example Company',
        location: 'Berlin',
        description: 'Build reliable TypeScript services.',
    },
};

describe('isValidReviseCoverLetterAsTextRequestBody', () => {
    it('accepts a valid body with or without optional job fields', () => {
        expect(isValidReviseCoverLetterAsTextRequestBody(validBody)).toBe(true);
        const { location, description, ...requiredJob } = validBody.job;
        void location;
        void description;
        expect(
            isValidReviseCoverLetterAsTextRequestBody({
                ...validBody,
                job: requiredJob,
            }),
        ).toBe(true);
    });

    it.each([
        null,
        'body',
        {},
        { ...validBody, selectedText: '   ' },
        { ...validBody, selectedText: 1 },
        { ...validBody, instruction: '' },
        { ...validBody, instruction: false },
        { ...validBody, coverLetterText: '\n' },
        { ...validBody, coverLetterText: [] },
        { ...validBody, job: null },
        { ...validBody, job: { ...validBody.job, title: ' ' } },
        { ...validBody, job: { ...validBody.job, company: 42 } },
        { ...validBody, job: { ...validBody.job, location: 42 } },
        { ...validBody, job: { ...validBody.job, description: false } },
    ])('rejects an invalid body %#', (body) => {
        expect(isValidReviseCoverLetterAsTextRequestBody(body)).toBe(false);
    });
});

describe('reviseCoverLetterAsText', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('passes the exact request context to the helper and returns its replacement', async () => {
        const replacementText =
            'My TypeScript experience aligns closely with this role.';
        reviseCoverLetterText.mockResolvedValue(replacementText);
        const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
            body: validBody,
        });
        const { response, status, json } = createResponse();

        await reviseCoverLetterAsText(request, response);

        expect(reviseCoverLetterText).toHaveBeenCalledWith({
            selectedText: validBody.selectedText,
            instruction: validBody.instruction,
            coverLetterText: validBody.coverLetterText,
            job: {
                title: validBody.job.title,
                company: validBody.job.company,
                location: validBody.job.location!,
                description: validBody.job.description!,
            },
        });
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ replacementText });
        expect(getCollection).not.toHaveBeenCalled();
    });

    it('maps an absent optional description to the package Job shape', async () => {
        const body = {
            ...validBody,
            job: {
                title: validBody.job.title,
                company: validBody.job.company,
            },
        };
        reviseCoverLetterText.mockResolvedValue('Replacement');
        const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
            body,
        });
        const { response } = createResponse();

        await reviseCoverLetterAsText(request, response);

        expect(reviseCoverLetterText).toHaveBeenCalledWith({
            selectedText: body.selectedText,
            instruction: body.instruction,
            coverLetterText: body.coverLetterText,
            job: {
                title: body.job.title,
                company: body.job.company,
                description: '',
            },
        });
    });

    it('returns 400 without invoking the helper when validation fails', async () => {
        const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
            body: { ...validBody, instruction: ' ' },
        });
        const { response, status, json } = createResponse();

        await reviseCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            message:
                'Invalid request body. Please provide non-empty selectedText, instruction, coverLetterText, job.title, and job.company strings, with optional string job.location and job.description fields.',
            error: '',
        });
        expect(reviseCoverLetterText).not.toHaveBeenCalled();
        expect(getCollection).not.toHaveBeenCalled();
    });

    it('returns 400 without invoking the helper when the selection is absent from the draft', async () => {
        const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
            body: { ...validBody, selectedText: 'Different passage' },
        });
        const { response, status, json } = createResponse();

        await reviseCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            message:
                'Invalid request body. selectedText must occur in coverLetterText.',
            error: '',
        });
        expect(reviseCoverLetterText).not.toHaveBeenCalled();
        expect(getCollection).not.toHaveBeenCalled();
    });

    it.each(['', '   ', '```text\nreplacement\n```'])(
        'returns a sanitized 500 for an invalid helper result %#',
        async (replacementText) => {
            reviseCoverLetterText.mockResolvedValue(replacementText);
            const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
                body: validBody,
            });
            const { response, status, json } = createResponse();

            await reviseCoverLetterAsText(request, response);

            expect(status).toHaveBeenCalledWith(500);
            expect(json).toHaveBeenCalledWith({
                message: 'Error revising cover letter',
                error: 'Provider request failed',
            });
            expect(getCollection).not.toHaveBeenCalled();
        },
    );

    it('returns a sanitized 500 when the provider fails', async () => {
        reviseCoverLetterText.mockRejectedValue(
            new Error(
                `Provider failed while processing ${validBody.selectedText}`,
            ),
        );
        const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
            body: validBody,
        });
        const { response, status, json } = createResponse();

        await reviseCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            message: 'Error revising cover letter',
            error: 'Provider request failed',
        });
        expect(JSON.stringify(json.mock.calls)).not.toContain(
            validBody.selectedText,
        );
        expect(getCollection).not.toHaveBeenCalled();
    });

    it('returns a sanitized 504 and never responds again when revision settles after the deadline', async () => {
        jest.useFakeTimers();
        let resolveRevision: ((value: string) => void) | undefined;
        reviseCoverLetterText.mockImplementation(
            () =>
                new Promise<string>((resolve) => {
                    resolveRevision = resolve;
                }),
        );
        const request = createRequest<ReviseCoverLetterAsTextRequestBody>({
            body: validBody,
        });
        const { response, status, json } = createResponse();

        const handler = reviseCoverLetterAsText(request, response);
        await jest.advanceTimersByTimeAsync(REVISE_COVER_LETTER_DEADLINE_MS);
        await handler;

        expect(status).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledWith(504);
        expect(json).toHaveBeenCalledTimes(1);
        expect(json).toHaveBeenCalledWith({
            message: 'Cover letter revision deadline exceeded',
            error: 'Request deadline exceeded',
        });

        resolveRevision?.('Late replacement');
        await Promise.resolve();
        await Promise.resolve();

        expect(status).toHaveBeenCalledTimes(1);
        expect(json).toHaveBeenCalledTimes(1);
        expect(getCollection).not.toHaveBeenCalled();
    });
});
