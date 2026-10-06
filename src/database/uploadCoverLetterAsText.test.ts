import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Request } from 'express';
import type { StoredCoverLetter, CoverLetterAsTextRequestBody } from '#types';
import {
  mockLocalDatabaseModule,
  getCollection,
} from '../testMockModules/localDatabase.test.js';
import {
  mockMongoDbModule,
  connect,
  close,
} from '../testMockModules/mongodb.test.js';
import {
  mockCoverLetterGeneratorModule,
  segmentCoverLetter,
  embedCoverLetterSegments,
} from '../testMockModules/coverLetterGenerator.test.js';
import createResponse from '../testHelpers/createResponse.test.js';

type InsertOneResult = {
  insertedId: string;
};

type FindOneAndReplaceOptions = {
  upsert: boolean;
  returnDocument: string;
};

const insertedCoverLetterId = 'inserted-cover-letter-id';
const upsertedCoverLetterId = 'upserted-cover-letter-id';
const insertOne =
  jest.fn<(coverLetter: StoredCoverLetter) => Promise<InsertOneResult>>();
const findOneAndReplace =
  jest.fn<
    (
      filter: { jobDuplicateKey: string },
      replacement: StoredCoverLetter,
      options: FindOneAndReplaceOptions,
    ) => Promise<{ _id: string } | null>
  >();

const invalidRequestBodyError = {
  error:
    'Invalid request body. Please provide a non-empty coverLetterText string and a non-empty jobDuplicateKey string.',
  message: 'An error occurred while uploading the cover letter',
};

const insertBody = {
  coverLetterText:
    'Dear Hiring Manager,\n\nI am excited to apply.\n\nBest regards\nOle',
};
const upsertBody = { ...insertBody, jobDuplicateKey: 'job-key-1' };

const uploadFailedResponse = {
  message: 'An error occurred while uploading the cover letter',
  error: 'Internal server error',
};

mockMongoDbModule();
mockLocalDatabaseModule();
mockCoverLetterGeneratorModule();

// The module under test is imported after the mocks to ensure the mocks are used
const { default: uploadCoverLetterAsText } =
  await import('./uploadCoverLetterAsText.js');

function createRequest(
  body: unknown,
): Request<object, object, CoverLetterAsTextRequestBody> {
  return { body } as Request<object, object, CoverLetterAsTextRequestBody>;
}

// invocationCallOrder is one counter shared by every mock, so comparing first
// calls shows the order the handler ran them in (NaN if never called).
function firstCall({
  mock,
}: {
  mock: { invocationCallOrder: number[] };
}): number {
  return mock.invocationCallOrder[0] ?? Number.NaN;
}

describe('uploadCoverLetterAsText', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    connect.mockResolvedValue();
    close.mockResolvedValue();
    insertOne.mockResolvedValue({ insertedId: insertedCoverLetterId });
    findOneAndReplace.mockResolvedValue({ _id: upsertedCoverLetterId });
    segmentCoverLetter.mockRejectedValue(new Error('Segmentation unavailable'));
    embedCoverLetterSegments.mockRejectedValue(
      new Error('Embedding unavailable'),
    );
    getCollection.mockReturnValue({ insertOne, findOneAndReplace });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('persists an unfinished draft verbatim without any provider calls and responds with its id', async () => {
    const coverLetterText =
      '  Subject: Application\r\n\r\nDear Hiring Manager,\n\nI am still writing  ';
    const request = createRequest({ coverLetterText });
    const { response, status, json } = createResponse();

    await uploadCoverLetterAsText(request, response);

    expect(segmentCoverLetter).not.toHaveBeenCalled();
    expect(embedCoverLetterSegments).not.toHaveBeenCalled();
    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        coverLetterText,
        mainBody: { text: coverLetterText, embedding: null },
      }),
    );
    for (const name of [
      'subject',
      'salutation',
      'introduction',
      'conclusion',
      'greetings',
    ] as const)
      expect(insertOne.mock.calls[0]?.[0][name]).toEqual({
        text: '',
        embedding: null,
      });
    expect(findOneAndReplace).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      message: 'Cover letter uploaded',
      coverLetterId: insertedCoverLetterId,
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('upserts the cover letter by jobDuplicateKey when provided', async () => {
    const coverLetterText =
      'Dear Hiring Manager,\n\nI am excited to apply.\n\nBest regards\nOle';
    const jobDuplicateKey = 'job-key-1';
    const request = createRequest({ coverLetterText, jobDuplicateKey });
    const { response, status, json } = createResponse();

    await uploadCoverLetterAsText(request, response);

    expect(segmentCoverLetter).not.toHaveBeenCalled();
    expect(embedCoverLetterSegments).not.toHaveBeenCalled();
    expect(findOneAndReplace).toHaveBeenCalledWith(
      { jobDuplicateKey },
      expect.objectContaining({
        coverLetterText,
        jobDuplicateKey,
        mainBody: { text: coverLetterText, embedding: null },
      }),
      { upsert: true, returnDocument: 'after' },
    );
    expect(insertOne).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      message: 'Cover letter uploaded',
      coverLetterId: upsertedCoverLetterId,
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when jobDuplicateKey is present but empty', async () => {
    const request = createRequest({
      coverLetterText: 'valid cover letter',
      jobDuplicateKey: '   ',
    });
    const { response, status, json } = createResponse();

    await uploadCoverLetterAsText(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
    expect(segmentCoverLetter).not.toHaveBeenCalled();
    expect(embedCoverLetterSegments).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(findOneAndReplace).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('returns 400 when the request body is invalid', async () => {
    const request = createRequest({ coverLetterText: '   ' });
    const { response, status, json } = createResponse();

    await uploadCoverLetterAsText(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
    expect(segmentCoverLetter).not.toHaveBeenCalled();
    expect(embedCoverLetterSegments).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
    expect(findOneAndReplace).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'insertOne', body: insertBody, write: insertOne },
    {
      name: 'findOneAndReplace',
      body: upsertBody,
      write: findOneAndReplace,
    },
  ])(
    'connects, writes using $name, and closes before confirming save',
    async ({ body, write }) => {
      const request = createRequest(body);
      const { response, status } = createResponse();

      await uploadCoverLetterAsText(request, response);

      expect(status).toHaveBeenCalledWith(201);
      expect(firstCall(connect)).toBeLessThan(firstCall(write));
      expect(firstCall(write)).toBeLessThan(firstCall(close));
      expect(close).toHaveBeenCalledTimes(1);
      expect(firstCall(close)).toBeLessThan(firstCall(status));
    },
  );

  it('replaces repeated autosaves with only the latest exact draft and clears old derived data', async () => {
    let saved: StoredCoverLetter = {
      jobDuplicateKey: 'job-key-1',
      subject: { text: 'Old subject', embedding: [1] },
      salutation: { text: 'Old greeting', embedding: [1] },
      introduction: { text: 'Old intro', embedding: [1] },
      mainBody: { text: 'Old body', embedding: [1] },
      conclusion: { text: 'Old ending', embedding: [1] },
      greetings: { text: 'Old signature', embedding: [1] },
    };
    findOneAndReplace.mockImplementation(async (_filter, replacement) => {
      saved = replacement;
      return { _id: upsertedCoverLetterId };
    });
    const drafts = [
      'Subject only',
      'Subject only\n\nDear Team,',
      '  Subject only\r\n\r\nDear Team,\n\nLatest unfinished edit  ',
    ];
    for (const coverLetterText of drafts) {
      const { response, status } = createResponse();
      await uploadCoverLetterAsText(
        createRequest({
          coverLetterText,
          jobDuplicateKey: 'job-key-1',
        }),
        response,
      );
      expect(status).toHaveBeenCalledWith(201);
      expect(saved.coverLetterText).toBe(coverLetterText);
      expect(saved.mainBody.text).toBe(coverLetterText);
    }
    for (const name of [
      'subject',
      'salutation',
      'introduction',
      'mainBody',
      'conclusion',
      'greetings',
    ] as const)
      expect(saved[name].embedding).toBeNull();
    expect(saved.subject.text).toBe('');
    expect(saved.greetings.text).toBe('');
    expect(segmentCoverLetter).not.toHaveBeenCalled();
    expect(embedCoverLetterSegments).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'connect', body: insertBody, dbCall: connect },
    { name: 'insertOne', body: insertBody, dbCall: insertOne },
    {
      name: 'findOneAndReplace',
      body: upsertBody,
      dbCall: findOneAndReplace,
    },
  ])(
    'returns 500 and closes the client exactly once when $name rejects',
    async ({ name, body, dbCall }) => {
      const error = new Error(`Synthetic ${name} cluster-private req-private`);
      dbCall.mockRejectedValue(error);
      const request = createRequest(body);
      const { response, status, json } = createResponse();

      await uploadCoverLetterAsText(request, response);

      expect(status).toHaveBeenCalledTimes(1);
      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(uploadFailedResponse);
      expect(console.error).toHaveBeenCalledWith(
        'An error occurred while uploading the cover letter', error,
      );
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it('returns 500 when closing the client fails after the write', async () => {
    const error = new Error('close failed');
    close.mockRejectedValue(error);
    const request = createRequest(insertBody);
    const { response, status, json } = createResponse();

    await uploadCoverLetterAsText(request, response);

    expect(insertOne).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(uploadFailedResponse);
    expect(console.error).toHaveBeenCalledWith(
      'An error occurred while uploading the cover letter',
      error,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
