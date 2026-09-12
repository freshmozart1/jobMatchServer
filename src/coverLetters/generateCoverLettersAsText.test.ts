import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { ScrapedJob, StoredCoverLetter } from '#types';
import type { WithId } from 'mongodb';
import type { CoverLetter } from 'cover-letter-generator';
import {
    mockMongoDbModule,
    connect,
    close,
    createToArray,
    createFind,
} from '../testMockModules/mongodb.test.js';
import {
    mockLocalDatabaseModule,
    getCollection,
} from '../testMockModules/localDatabase.test.js';
import {
    mockCoverLetterGeneratorModule,
    embedJob,
    getTopXSimilarCoverLetters,
    generateCoverLetter,
    segmentCoverLetter,
} from '../testMockModules/coverLetterGenerator.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import createRequest from '../testHelpers/createRequest.test.js';
import { createJob } from '../testHelpers/createJob.test.js';

mockMongoDbModule();
mockLocalDatabaseModule();
mockCoverLetterGeneratorModule();

// The module under test and the adapters are imported after the mocks to
// ensure the mocks are used - both statically import 'cover-letter-generator'
// at module scope (the adapters import its COVER_LETTER_SEGMENT_NAMES value),
// so that mock must be registered before these imports run.
const {
    default: generateCoverLetterAsText,
    isValidGenerateCoverLetterAsTextRequestBody,
} = await import('./generateCoverLettersAsText.js');
const { getGeneratorCoverLetterTextSegments } =
    await import('./coverLetterAdapters.js');

const validBase = {
    sourceHostname: 'www.linkedin.com',
    sourceUrl: 'https://www.linkedin.com/jobs/view/1234567/',
    title: 'Software Engineer',
    company: 'Acme Corp',
    location: 'Berlin',
    descriptionText: 'We are looking for an engineer.',
    postedAt: '2024-01-01',
    scrapedAt: new Date().toISOString(),
    tags: ['Full-time'],
    duplicateKey: 'linkedin:1234567',
    x: 3,
};

describe('isValidGenerateCoverLetterAsTextRequestBody', () => {
    it('accepts a complete valid body', () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody(validBase)).toBe(
            true,
        );
    });

    it('accepts a body with optional fields absent', () => {
        const { location, descriptionText, postedAt, tags, ...rest } =
            validBase;
        void location;
        void descriptionText;
        void postedAt;
        void tags;
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...rest,
                location: undefined,
                descriptionText: undefined,
                postedAt: undefined,
                tags: undefined,
            }),
        ).toBe(true);
    });

    it('accepts x explicitly set to undefined', () => {
        const { x, ...rest } = validBase;
        void x;
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...rest,
                x: undefined,
            }),
        ).toBe(true);
    });

    it('accepts a body where the x key is absent entirely (the realistic shape of a JSON request that omits it)', () => {
        const { x, ...rest } = validBase;
        void x;
        expect(isValidGenerateCoverLetterAsTextRequestBody(rest)).toBe(true);
    });

    it('accepts a positive integer x', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({ ...validBase, x: 5 }),
        ).toBe(true);
    });

    it('rejects a non-integer x', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...validBase,
                x: 1.5,
            }),
        ).toBe(false);
    });

    it('rejects a zero x', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({ ...validBase, x: 0 }),
        ).toBe(false);
    });

    it('rejects a negative x', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...validBase,
                x: -1,
            }),
        ).toBe(false);
    });

    it('rejects a non-number x', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...validBase,
                x: '3',
            }),
        ).toBe(false);
    });

    it('returns false when body is null', () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody(null)).toBe(false);
    });

    it('returns false when body is not an object', () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody('string')).toBe(
            false,
        );
    });

    it('returns false when sourceHostname is missing', () => {
        const { sourceHostname, ...rest } = validBase;
        void sourceHostname;
        expect(isValidGenerateCoverLetterAsTextRequestBody(rest)).toBe(false);
    });

    it('returns false when title is not a string', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...validBase,
                title: 123,
            }),
        ).toBe(false);
    });

    it('returns false when tags contains a non-string element', () => {
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...validBase,
                tags: ['Full-time', 42],
            }),
        ).toBe(false);
    });

    it('returns false when scrapedAt is missing', () => {
        const { scrapedAt, ...rest } = validBase;
        void scrapedAt;
        expect(isValidGenerateCoverLetterAsTextRequestBody(rest)).toBe(false);
    });
});

const find = createFind<WithId<StoredCoverLetter>>();
const toArray = createToArray<WithId<StoredCoverLetter>>();
const findOneAndReplace = jest.fn<
    (
        filter: { jobDuplicateKey: string },
        replacement: StoredCoverLetter,
        options: { upsert: boolean; returnDocument: string },
    ) => Promise<{ _id: string } | null>
>();

const storedCoverLetter: WithId<StoredCoverLetter> = {
    _id: {
        toString: () => 'id-1',
    } as unknown as WithId<StoredCoverLetter>['_id'],
    subject: { text: 'Subject: Application', embedding: [0.1] },
    salutation: { text: 'Dear Hiring Manager,', embedding: [0.2] },
    introduction: { text: 'I am excited to apply.', embedding: [0.3] },
    mainBody: { text: 'I build software.', embedding: [0.4] },
    conclusion: {
        text: 'I look forward to speaking with you.',
        embedding: [0.5],
    },
    greetings: { text: 'Best regards\nOle', embedding: [0.6] },
};

const expectedPackageCoverLetter = {
    subject: { text: 'Subject: Application', embedding: [0.1] },
    salutation: { text: 'Dear Hiring Manager,', embedding: [0.2] },
    introduction: { text: 'I am excited to apply.', embedding: [0.3] },
    mainBody: { text: 'I build software.', embedding: [0.4] },
    conclusion: {
        text: 'I look forward to speaking with you.',
        embedding: [0.5],
    },
    greetings: { text: 'Best regards\nOle', embedding: [0.6] },
} satisfies CoverLetter;

const matchedCoverLetter = {
    subject: { text: 'Matched subject' },
    salutation: { text: 'Dear Hiring Manager,' },
    introduction: { text: 'Matched introduction' },
    mainBody: { text: 'Matched main body' },
    conclusion: { text: 'Matched conclusion' },
    greetings: { text: 'Best regards\nOle' },
} satisfies CoverLetter;

const generatedCoverLetter = {
    subject: { text: 'Generated subject', embedding: [1.1] },
    salutation: { text: 'Dear Hiring Manager,', embedding: [1.2] },
    introduction: { text: 'Generated introduction', embedding: [1.3] },
    mainBody: { text: 'Generated main body', embedding: [1.4] },
    conclusion: { text: 'Generated conclusion', embedding: [1.5] },
    greetings: { text: 'Best regards\nOle', embedding: [1.6] },
} satisfies CoverLetter;

const storedGeneratedCoverLetter = {
    subject: { text: 'Generated subject', embedding: [1.1] },
    salutation: { text: 'Dear Hiring Manager,', embedding: [1.2] },
    introduction: { text: 'Generated introduction', embedding: [1.3] },
    mainBody: { text: 'Generated main body', embedding: [1.4] },
    conclusion: { text: 'Generated conclusion', embedding: [1.5] },
    greetings: { text: 'Best regards\nOle', embedding: [1.6] },
} satisfies StoredCoverLetter;

const jobEmbedding = [0.7, 0.8, 0.9];
const savedCoverLetterId = 'saved-cover-letter-id';

describe('generateCoverLetterAsText', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});

        connect.mockResolvedValue();
        close.mockResolvedValue();
        getCollection.mockReturnValue({ find, findOneAndReplace });
        toArray.mockResolvedValue([storedCoverLetter]);
        find.mockReturnValue({ toArray });
        findOneAndReplace.mockResolvedValue({ _id: savedCoverLetterId });
        embedJob.mockResolvedValue(jobEmbedding);
        getTopXSimilarCoverLetters.mockResolvedValue([
            { coverLetter: matchedCoverLetter, similarity: 0.9 },
        ]);
        generateCoverLetter.mockResolvedValue(generatedCoverLetter);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('ranks stored cover letters, persists the generated segments, and returns saved-state metadata', async () => {
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: { ...createJob<ScrapedJob>(), x: 2 },
        });
        const { response, status, json } = createResponse();

        await generateCoverLetterAsText(request, response);

        expect(embedJob).toHaveBeenCalledWith({
            title: 'Software Engineer',
            company: 'Example Company',
            location: 'Remote',
            description: 'Build and maintain TypeScript services.',
        });
        expect(getTopXSimilarCoverLetters).toHaveBeenCalledWith(
            2,
            jobEmbedding,
            [expectedPackageCoverLetter],
        );
        expect(generateCoverLetter).toHaveBeenCalledWith(
            {
                title: 'Software Engineer',
                company: 'Example Company',
                location: 'Remote',
                description: 'Build and maintain TypeScript services.',
            },
            [getGeneratorCoverLetterTextSegments(matchedCoverLetter)],
        );
        expect(findOneAndReplace).toHaveBeenCalledWith(
            { jobDuplicateKey: 'linkedin:123456789' },
            {
                ...storedGeneratedCoverLetter,
                jobDuplicateKey: 'linkedin:123456789',
            },
            { upsert: true, returnDocument: 'after' },
        );
        expect(segmentCoverLetter).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({
            coverLetter:
                'Generated subject\n\nDear Hiring Manager,\n\nGenerated introduction\n\nGenerated main body\n\nGenerated conclusion\n\nBest regards\nOle',
            saved: true,
            coverLetterId: savedCoverLetterId,
        });
        expect(connect).toHaveBeenCalledTimes(2);
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('defaults x to 3 when the x key is absent entirely from the request body', async () => {
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: createJob<ScrapedJob & { x?: number }>(),
        });
        const { response } = createResponse();

        await generateCoverLetterAsText(request, response);

        expect(getTopXSimilarCoverLetters).toHaveBeenCalledWith(
            3,
            jobEmbedding,
            [expectedPackageCoverLetter],
        );
    });

    it('returns 400 when the request body is invalid', async () => {
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: { title: 'Only a title' } as unknown as ScrapedJob & {
                x?: number;
            },
        });
        const { response, status, json } = createResponse();

        await generateCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            message:
                'Invalid request body. Please provide all required fields with correct types.',
            error: '',
        });
        expect(connect).not.toHaveBeenCalled();
        expect(embedJob).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'connect',
            reject: (error: Error) => connect.mockRejectedValue(error),
        },
        {
            name: 'find().toArray',
            reject: (error: Error) => toArray.mockRejectedValue(error),
        },
        {
            name: 'embedJob',
            reject: (error: Error) => embedJob.mockRejectedValue(error),
        },
        {
            name: 'getTopXSimilarCoverLetters',
            reject: (error: Error) =>
                getTopXSimilarCoverLetters.mockRejectedValue(error),
        },
        {
            name: 'generateCoverLetter',
            reject: (error: Error) =>
                generateCoverLetter.mockRejectedValue(error),
        },
    ])('returns a sanitized 500 when $name rejects', async ({ reject }) => {
        const sentinel = 'org-secret-135';
        const error = new Error(
            `429 You exceeded your current quota (${sentinel}, req_abc123)`,
        );
        reject(error);
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: createJob<ScrapedJob & { x?: number }>(),
        });
        const { response, status, json } = createResponse();

        await generateCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledTimes(1);
        expect(json).toHaveBeenCalledWith({
            message: 'Error generating cover letter',
            error: 'Provider request failed',
        });
        expect(JSON.stringify(json.mock.calls)).not.toContain(sentinel);
        expect(console.error).toHaveBeenCalledWith(
            'Error generating cover letter',
            error,
        );
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('returns a sanitized 500 and closes both clients when saving fails', async () => {
        const error = new Error('save failed');
        findOneAndReplace.mockRejectedValue(error);
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: createJob<ScrapedJob & { x?: number }>(),
        });
        const { response, status, json } = createResponse();

        await generateCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            message: 'Error generating cover letter',
            error: 'Provider request failed',
        });
        expect(console.error).toHaveBeenCalledWith(
            'Error generating cover letter',
            error,
        );
        expect(connect).toHaveBeenCalledTimes(2);
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('closes the client after reading stored cover letters and before the LLM round trips', async () => {
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: createJob<ScrapedJob & { x?: number }>(),
        });
        const { response, status } = createResponse();
        // invocationCallOrder is shared across every mock, so comparing first
        // calls shows the order the handler ran them in (NaN if never called).
        const firstCall = ({
            mock,
        }: {
            mock: { invocationCallOrder: number[] };
        }): number => mock.invocationCallOrder[0] ?? Number.NaN;

        await generateCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(200);
        expect(connect).toHaveBeenCalledTimes(2);
        expect(close).toHaveBeenCalledTimes(2);
        expect(firstCall(toArray)).toBeLessThan(firstCall(close));
        expect(firstCall(close)).toBeLessThan(firstCall(embedJob));
        expect(firstCall(embedJob)).toBeLessThan(
            firstCall(generateCoverLetter),
        );
        expect(generateCoverLetter.mock.invocationCallOrder[0]).toBeLessThan(
            connect.mock.invocationCallOrder[1] ?? Number.NaN,
        );
        expect(connect.mock.invocationCallOrder[1]).toBeLessThan(
            close.mock.invocationCallOrder[1] ?? Number.NaN,
        );
    });

    it('returns a sanitized 500 without generating when closing the client fails after a successful read', async () => {
        const error = new Error('close failed');
        close.mockRejectedValue(error);
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: createJob<ScrapedJob & { x?: number }>(),
        });
        const { response, status, json } = createResponse();

        await generateCoverLetterAsText(request, response);

        expect(toArray).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledTimes(1);
        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({
            message: 'Error generating cover letter',
            error: 'Provider request failed',
        });
        expect(console.error).toHaveBeenCalledWith(
            'Error generating cover letter',
            error,
        );
        expect(close).toHaveBeenCalledTimes(1);
        expect(embedJob).not.toHaveBeenCalled();
    });
});
