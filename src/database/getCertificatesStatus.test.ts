import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import {
    mockLocalDatabaseModule,
    getCollection,
} from '../testMockModules/localDatabase.test.js';
import {
    mockMongoDbModule,
    connect,
    close,
} from '../testMockModules/mongodb.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import createJobDuplicateKeyRequest from '../testHelpers/createJobDuplicateKeyRequest.test.js';

mockMongoDbModule();
mockLocalDatabaseModule();
const { default: getCertificatesStatus } =
    await import('./getCertificatesStatus.js');

const findJob = jest.fn<() => Promise<unknown>>();
const findCertificate = jest.fn<() => Promise<unknown>>();

describe('getCertificatesStatus public errors', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        connect.mockResolvedValue();
        close.mockResolvedValue();
        findJob.mockResolvedValue({
            _id: { toHexString: () => 'synthetic-job-id' },
        });
        findCertificate.mockResolvedValue({ _id: 'synthetic-certificate-id' });
        getCollection.mockImplementation((_client: unknown, name: unknown) => ({
            findOne: name === 'jobs' ? findJob : findCertificate,
        }));
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it.each([
        { lookup: findJob, publicError: 'Job not found' },
        { lookup: findCertificate, publicError: 'Certificates not found' },
    ])(
        'preserves the curated missing-record error $publicError',
        async ({ lookup, publicError }) => {
            lookup.mockResolvedValue(null);
            const { response, status, json } = createResponse();

            await getCertificatesStatus(
                createJobDuplicateKeyRequest('synthetic-key'),
                response,
            );

            expect(status).toHaveBeenCalledWith(404);
            expect(json).toHaveBeenCalledWith({
                message: 'Error checking certificates status',
                error: publicError,
            });
            expect(close).toHaveBeenCalledTimes(1);
        },
    );

    it.each([connect, findJob, findCertificate])(
        'sanitizes a driver failure while logging it',
        async (operation) => {
            const error = new Error(
                'Synthetic MongoDB cluster.private.invalid connection failed',
            );
            operation.mockRejectedValue(error);
            const { response, status, json } = createResponse();

            await getCertificatesStatus(
                createJobDuplicateKeyRequest('synthetic-key'),
                response,
            );

            expect(status).toHaveBeenCalledWith(500);
            expect(json).toHaveBeenCalledWith({
                message: 'Error checking certificates status',
                error: 'Internal server error',
            });
            expect(console.error).toHaveBeenCalledWith(
                'Error checking certificates status',
                error,
            );
            expect(close).toHaveBeenCalledTimes(1);
        },
    );
});
