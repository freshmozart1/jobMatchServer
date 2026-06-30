import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoredCv, StoredScrapedJob } from '#types';
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
import createRequest from '../testHelpers/createRequest.test.js';
import { createJob, duplicateKey } from '../testHelpers/createJob.test.js';

const findOneJob =
  jest.fn<
    (
      filter: unknown,
      options?: unknown,
    ) => Promise<
      (StoredScrapedJob & { _id: { toHexString: () => string } }) | null
    >
  >();
const findOneCv =
  jest.fn<(filter: unknown, options?: unknown) => Promise<StoredCv | null>>();

const mockJobId = '507f1f77bcf86cd799439011';

const storedCv: StoredCv = {
  jobId: mockJobId,
  filePath: 'uploads/cv/testfile',
};

mockMongoDbModule();
mockLocalDatabaseModule();

const { default: getCVStatus } = await import('./getCVStatus.js');

describe('getCVStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    connect.mockResolvedValue();
    close.mockResolvedValue();
    findOneJob.mockResolvedValue({
      ...createJob<StoredScrapedJob>(true),
      _id: { toHexString: () => mockJobId },
    });
    findOneCv.mockResolvedValue(storedCv);
    getCollection.mockImplementation(
      (_client: unknown, collectionName: unknown) => {
        if (collectionName === 'jobs') return { findOne: findOneJob };
        return { findOne: findOneCv };
      },
    );
  });

  it('returns 200 when the job and CV exist', async () => {
    const request = createRequest<object, never, { jobDuplicateKey: string }>({
      params: { jobDuplicateKey: duplicateKey },
    });
    const { response, status, json } = createResponse();

    await getCVStatus(request, response);

    expect(findOneJob).toHaveBeenCalledWith(
      { duplicateKey },
      { projection: { _id: 1 } },
    );
    expect(findOneCv).toHaveBeenCalledWith(
      { jobId: mockJobId },
      { projection: { _id: 1 } },
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ message: 'CV exists' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the job is not found', async () => {
    findOneJob.mockResolvedValue(null);
    const request = createRequest<object, never, { jobDuplicateKey: string }>({
      params: { jobDuplicateKey: duplicateKey },
    });
    const { response, status, json } = createResponse();

    await getCVStatus(request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: 'Job not found',
      message: 'Error checking CV status',
    });
    expect(findOneCv).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the CV is not found', async () => {
    findOneCv.mockResolvedValue(null);
    const request = createRequest<object, never, { jobDuplicateKey: string }>({
      params: { jobDuplicateKey: duplicateKey },
    });
    const { response, status, json } = createResponse();

    await getCVStatus(request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: 'CV not found',
      message: 'Error checking CV status',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on a database error', async () => {
    connect.mockRejectedValue(new Error('DB connection failed'));
    const request = createRequest<object, never, { jobDuplicateKey: string }>({
      params: { jobDuplicateKey: duplicateKey },
    });
    const { response, status, json } = createResponse();

    await getCVStatus(request, response);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: 'DB connection failed',
      message: 'Error checking CV status',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
