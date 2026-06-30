import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type {
  CreateJobInDatabaseRequestBody,
  ScrapedJob,
  StoredScrapedJob,
} from '#types';
import {
  mockLocalDatabaseModule,
  getCollection,
} from '../testMockModules/localDatabase.test.js';
import { mockMongoDbModule, connect } from '../testMockModules/mongodb.test.js';
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
  error: 'Request body must include job and boolean like fields',
  message: 'Request body must include job and boolean like fields',
};

mockMongoDbModule();
mockLocalDatabaseModule();

const { default: createJobInDatabase } =
  await import('./createJobInDatabase.js');

describe('createJobInDatabase', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
  });
});
