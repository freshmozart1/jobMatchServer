import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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
} from '../testMockModules/coverLetterGenerator.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import createRequest from '../testHelpers/createRequest.test.js';
import { createJob } from '../testHelpers/createJob.test.js';
import {
    getGeneratorCoverLetterTextSegments,
    reconstructCoverLetterText,
} from './coverLetterAdapters.js';

mockMongoDbModule();
mockLocalDatabaseModule();
mockCoverLetterGeneratorModule();

// The module under test is imported after the mocks to ensure the mocks are
// used - it statically imports 'cover-letter-generator' at module scope, so
// that mock must be registered before this import runs.
const {
    default: generateCoverLetterAsText,
    isValidGenerateCoverLetterAsTextRequestBody,
} = await import('./generateCoverLettersAsText.js');

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

    it('accepts missing x', () => {
        const { x, ...rest } = validBase;
        void x;
        expect(
            isValidGenerateCoverLetterAsTextRequestBody({
                ...rest,
                x: undefined,
            }),
        ).toBe(true);
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
    subject: { text: 'Generated subject' },
    salutation: { text: 'Dear Hiring Manager,' },
    introduction: { text: 'Generated introduction' },
    mainBody: { text: 'Generated main body' },
    conclusion: { text: 'Generated conclusion' },
    greetings: { text: 'Best regards\nOle' },
} satisfies CoverLetter;

const jobEmbedding = [0.7, 0.8, 0.9];

describe('generateCoverLetterAsText', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        connect.mockResolvedValue();
        close.mockResolvedValue();
        getCollection.mockReturnValue({ find });
        toArray.mockResolvedValue([storedCoverLetter]);
        find.mockReturnValue({ toArray });
        embedJob.mockResolvedValue(jobEmbedding);
        getTopXSimilarCoverLetters.mockResolvedValue([
            { coverLetter: matchedCoverLetter, similarity: 0.9 },
        ]);
        generateCoverLetter.mockResolvedValue(generatedCoverLetter);
    });

    it('ranks stored cover letters against the job and returns the generated cover letter text', async () => {
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
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({
            coverLetter: reconstructCoverLetterText(
                getGeneratorCoverLetterTextSegments(generatedCoverLetter),
            ),
        });
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('defaults x to 3 when it is omitted from the request body', async () => {
        const request = createRequest<ScrapedJob & { x?: number }>({
            body: { ...createJob<ScrapedJob>(), x: undefined },
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
});
