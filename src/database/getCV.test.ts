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
import createJobDuplicateKeyRequest from '../testHelpers/createJobDuplicateKeyRequest.test.js';
import { createJob, duplicateKey } from '../testHelpers/createJob.test.js';
import path from 'path';

const findOneJob =
  jest.fn<
    (
      filter: unknown,
    ) => Promise<
      (StoredScrapedJob & { _id: { toHexString: () => string } }) | null
    >
  >();
const findOneCv = jest.fn<(filter: unknown) => Promise<StoredCv | null>>();
const sendFile =
  jest.fn<(filePath: string, callback: (err?: Error) => void) => void>();
const setHeader = jest.fn<(name: string, value: string) => void>();

const mockJobId = '507f1f77bcf86cd799439011';

const storedCv: StoredCv = {
  jobId: mockJobId,
  filePath: 'uploads/cv/testfile',
};

mockMongoDbModule();
mockLocalDatabaseModule();

const { default: getCV } = await import('./getCV.js');

describe('getCV', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    connect.mockResolvedValue();
    close.mockResolvedValue();
    findOneJob.mockResolvedValue({
      ...createJob<StoredScrapedJob>(true),
      _id: { toHexString: () => mockJobId },
    });
    findOneCv.mockResolvedValue(storedCv);
    sendFile.mockImplementation((_filePath, callback) => callback());
    getCollection.mockImplementation(
      (_client: unknown, collectionName: unknown) => {
        if (collectionName === 'jobs') return { findOne: findOneJob };
        return { findOne: findOneCv };
      },
    );
  });

  it('sends the CV file when the job and CV are found', async () => {
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();
    (response as unknown as { sendFile: typeof sendFile }).sendFile = sendFile;
    (response as unknown as { setHeader: typeof setHeader }).setHeader =
      setHeader;

    await getCV(request, response);

    expect(findOneJob).toHaveBeenCalledWith({ duplicateKey });
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(sendFile).toHaveBeenCalledWith(
      path.resolve(storedCv.filePath),
      expect.any(Function),
    );
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the job is not found', async () => {
    findOneJob.mockResolvedValue(null);
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();

    await getCV(request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: 'Job not found',
      message: 'Error retrieving CV',
    });
    expect(findOneCv).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the CV is not found', async () => {
    findOneCv.mockResolvedValue(null);
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();

    await getCV(request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: 'CV not found',
      message: 'Error retrieving CV',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
