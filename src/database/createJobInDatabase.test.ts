import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
    CreateJobInDatabaseRequestBody,
    ScrapedJob,
    StoredScrapedJob,
} from '#types';
import {
    mockLocalDatabaseModule,
    getCollection,
    connectionStringConfigured,
} from '../testMockModules/localDatabase.test.js';
import {
    mockMongoDbModule,
    connect,
    close,
} from '../testMockModules/mongodb.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import createRequest from '../testHelpers/createRequest.test.js';
import { createJob, duplicateKey } from '../testHelpers/createJob.test.js';

const jobId = 'upserted-job-id';
const findOneAndReplace =
    jest.fn<
        (
            filter: object,
            replacement: StoredScrapedJob,
            options: object,
        ) => Promise<StoredScrapedJob & { _id: string }>
    >();
const invalidRequestBodyError = {
    error: 'Request body must include a valid job (including a non-empty string duplicateKey and finite numeric embedding) and a boolean like field',
    message:
        'Request body must include a valid job (including a non-empty string duplicateKey and finite numeric embedding) and a boolean like field',
};

mockMongoDbModule();
mockLocalDatabaseModule();

const { default: createJobInDatabase } =
    await import('./createJobInDatabase.js');
const { MongoClient } = await import('mongodb');

describe('createJobInDatabase', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        connectionStringConfigured.mockReset().mockReturnValue(true);

        findOneAndReplace.mockResolvedValue({
            ...createJob<StoredScrapedJob>(true),
            _id: jobId,
        });
        connect.mockResolvedValue();
        getCollection.mockReturnValue({ findOneAndReplace });
    });

    it('upserts the job by duplicateKey and responds with the job id', async () => {
        const job = createJob<ScrapedJob>();
        const like = true;
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { job, like },
        });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(findOneAndReplace).toHaveBeenCalledWith(
            { duplicateKey },
            { ...job, like },
            { upsert: true, returnDocument: 'after' },
        );
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: 'Job created', jobId });
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when the request body does not include a job object', async () => {
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { like: true },
        });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
        expect(connectionStringConfigured).not.toHaveBeenCalled();
    });

    it('returns 400 when like is not a boolean', async () => {
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { job: createJob<ScrapedJob>(), like: 'true' },
        });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
        expect(connectionStringConfigured).not.toHaveBeenCalled();
    });

    it.each([
        ['array body', []],
        ['null body', null],
        ['empty job', { job: {}, like: true }],
        ['array job', { job: [], like: true }],
        ['null job', { job: null, like: true }],
        [
            'class instance',
            {
                job: Object.assign(new (class {})(), createJob<ScrapedJob>()),
                like: true,
            },
        ],
        [
            'unknown request field',
            { job: createJob<ScrapedJob>(), like: true, extra: 'value' },
        ],
    ])('rejects %s before database access', async (_description, body) => {
        const request = createRequest<CreateJobInDatabaseRequestBody>({ body });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(connectionStringConfigured).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
        expect(getCollection).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });

    it.each([
        ['operator duplicate key', { duplicateKey: { $ne: null } }],
        ['array duplicate key', { duplicateKey: [duplicateKey] }],
        ['empty duplicate key', { duplicateKey: '' }],
        ['blank duplicate key', { duplicateKey: ' \t\n' }],
        ['numeric duplicate key', { duplicateKey: 42 }],
        ['missing duplicate key', { duplicateKey: undefined }],
        ['missing source hostname', { sourceHostname: undefined }],
        ['invalid source URL', { sourceUrl: false }],
        ['missing title', { title: undefined }],
        ['invalid company', { company: [] }],
        ['missing scrape date', { scrapedAt: undefined }],
        ['missing embedding', { embedding: undefined }],
        ['empty embedding', { embedding: [] }],
        ['nonnumeric embedding', { embedding: ['0.1'] }],
        ['null vector component', { embedding: [null] }],
        ['NaN vector component', { embedding: [NaN] }],
        ['infinite vector component', { embedding: [Infinity] }],
        ['sparse embedding', { embedding: new Array(2) }],
        ['invalid optional source job id', { sourceJobId: 123 }],
        ['invalid optional location', { location: {} }],
        ['invalid optional description', { descriptionText: null }],
        ['invalid optional posting date', { postedAt: [] }],
        ['invalid optional tags', { tags: 'typescript' }],
        ['invalid tag element', { tags: [1] }],
        ['sparse tags', { tags: new Array(1) }],
        ['nonnumeric match', { match: '0.5' }],
        ['nonfinite match', { match: -Infinity }],
        ['missing addresses', { companyAddresses: undefined }],
        ['nonarray addresses', { companyAddresses: {} }],
        ['null address', { companyAddresses: [null] }],
        ['incomplete address', { companyAddresses: [{ city: 'Berlin' }] }],
        [
            'invalid address field',
            {
                companyAddresses: [
                    {
                        streetAddress: '',
                        city: '',
                        postalCode: 10115,
                        countryCode: 'DE',
                    },
                ],
            },
        ],
        [
            'unknown address field',
            {
                companyAddresses: [
                    {
                        streetAddress: '',
                        city: '',
                        postalCode: '',
                        countryCode: '',
                        $set: {},
                    },
                ],
            },
        ],
        ['unknown job operator field', { $set: { title: 'changed' } }],
        ['storage-owned id', { _id: 'other-job-id' }],
        ['storage-owned like field', { like: false }],
    ])('rejects %s before database access', async (_description, override) => {
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: {
                job: { ...createJob<ScrapedJob>(), ...override },
                like: false,
            },
        });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(connectionStringConfigured).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
        expect(getCollection).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });

    it('validates malformed jobs even when the database is not configured', async () => {
        connectionStringConfigured.mockReturnValue(false);
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { job: { duplicateKey: { $ne: null } }, like: true },
        });
        const { response, status } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(connectionStringConfigured).not.toHaveBeenCalled();
        expect(MongoClient).not.toHaveBeenCalled();
    });

    it('accepts producer-normalized blank strings, omitted optionals, and an empty address list', async () => {
        const job: ScrapedJob = {
            sourceHostname: '',
            sourceUrl: '',
            title: '',
            company: '',
            scrapedAt: '',
            duplicateKey,
            companyAddresses: [],
            embedding: [0, -0.5, 1],
        };
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { job, like: false },
        });
        const { response, status } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(201);
        expect(findOneAndReplace).toHaveBeenCalledWith(
            { duplicateKey },
            { ...job, like: false },
            { upsert: true, returnDocument: 'after' },
        );
    });

    it('accepts blank address strings, empty tags, and a finite zero match', async () => {
        const job = {
            ...createJob<ScrapedJob>(),
            tags: [],
            match: 0,
            companyAddresses: [
                {
                    streetAddress: '',
                    city: '',
                    postalCode: '',
                    countryCode: '',
                },
            ],
        };
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { job, like: false },
        });
        const { response, status } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(201);
        expect(findOneAndReplace).toHaveBeenCalledWith(
            { duplicateKey },
            { ...job, like: false },
            { upsert: true, returnDocument: 'after' },
        );
    });

    it('retains the database configuration guard for valid jobs', async () => {
        connectionStringConfigured.mockReturnValue(false);
        const request = createRequest<CreateJobInDatabaseRequestBody>({
            body: { job: createJob<ScrapedJob>(), like: true },
        });
        const { response } = createResponse();

        await createJobInDatabase(request, response);

        expect(connectionStringConfigured).toHaveBeenCalledWith(response);
        expect(MongoClient).not.toHaveBeenCalled();
        expect(findOneAndReplace).not.toHaveBeenCalled();
    });

    it('updates only the requested job across repeated upserts and rejects operator replacement', async () => {
        const unrelated = {
            ...createJob<StoredScrapedJob>(false),
            duplicateKey: 'linkedin:unrelated',
            _id: 'unrelated-id',
        };
        const records = new Map<string, StoredScrapedJob & { _id: string }>([
            [unrelated.duplicateKey, unrelated],
        ]);
        findOneAndReplace.mockImplementation(
            async (filter, replacement, options) => {
                expect(filter).toEqual({
                    duplicateKey: replacement.duplicateKey,
                });
                expect(options).toEqual({
                    upsert: true,
                    returnDocument: 'after',
                });
                const record = {
                    ...replacement,
                    _id: records.get(replacement.duplicateKey)?._id ?? jobId,
                };
                records.set(replacement.duplicateKey, record);
                return record;
            },
        );
        const job = createJob<ScrapedJob>();
        const first = createResponse();
        await createJobInDatabase(
            createRequest({ body: { job, like: true } }),
            first.response,
        );
        const second = createResponse();
        const updatedJob = { ...job, title: 'Updated job title' };
        await createJobInDatabase(
            createRequest({ body: { job: updatedJob, like: false } }),
            second.response,
        );
        const malformed = createResponse();
        await createJobInDatabase(
            createRequest({
                body: {
                    job: { ...job, duplicateKey: { $ne: null } },
                    like: true,
                },
            }),
            malformed.response,
        );

        expect(first.status).toHaveBeenCalledWith(201);
        expect(second.status).toHaveBeenCalledWith(201);
        expect(first.json).toHaveBeenCalledWith({
            message: 'Job created',
            jobId,
        });
        expect(second.json).toHaveBeenCalledWith({
            message: 'Job created',
            jobId,
        });
        expect(malformed.status).toHaveBeenCalledWith(400);
        expect(findOneAndReplace).toHaveBeenCalledTimes(2);
        expect(records.size).toBe(2);
        expect(records.get(duplicateKey)).toEqual({
            ...updatedJob,
            like: false,
            _id: jobId,
        });
        expect(records.get(unrelated.duplicateKey)).toEqual(unrelated);
        expect(connect).toHaveBeenCalledTimes(2);
        expect(close).toHaveBeenCalledTimes(2);
    });
});
