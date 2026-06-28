import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoredCoverLetter, ScrapedJob, TextEmbedding } from '#types';
import type { WithId } from 'mongodb';
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
  mockCalculateCosineSimilarityModule,
  calculateCosineSimilarity,
} from '../testMockModules/calculateCosineSimilarity.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import createRequest from '../testHelpers/createRequest.test.js';
import {
  createJob,
  embedding as jobEmbedding,
} from '../testHelpers/createJob.test.js';

const find = createFind<WithId<StoredCoverLetter>>();
const toArray = createToArray<WithId<StoredCoverLetter>>();

mockMongoDbModule();
mockLocalDatabaseModule();
mockCalculateCosineSimilarityModule();

// The module under test is imported after the mocks to ensure the mocks are used
const { default: getTopXSimilarCoverLetters } =
  await import('./getTopXSimilarCoverLetters.js');

function createStoredCoverLetter(
  introductionEmbedding: TextEmbedding,
  mainBodyEmbedding: TextEmbedding,
  conclusionEmbedding: TextEmbedding,
  label: string,
  id: string,
): WithId<StoredCoverLetter> {
  return {
    _id: { toString: () => id } as unknown as WithId<StoredCoverLetter>['_id'],
    subject: { text: `Subject ${label}`, embedding: null },
    salutation: { text: 'Dear Hiring Manager,', embedding: null },
    introduction: {
      text: `Introduction ${label}`,
      embedding: introductionEmbedding,
    },
    mainBody: { text: `Main body ${label}`, embedding: mainBodyEmbedding },
    conclusion: { text: `Conclusion ${label}`, embedding: conclusionEmbedding },
    greetings: { text: 'Best regards\nOle', embedding: null },
  };
}

describe('getTopXSimilarCoverLetters', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    connect.mockResolvedValue();
    close.mockResolvedValue();
    getCollection.mockReturnValue({ find });
    toArray.mockResolvedValue([]);
    find.mockReturnValue({ toArray });
  });

  it('returns the top x cover letters sorted by cosine similarity', async () => {
    const firstIntroductionEmbedding = [0.1, 0.2, 0.3] satisfies TextEmbedding;
    const firstMainBodyEmbedding = [0.2, 0.3, 0.4] satisfies TextEmbedding;
    const firstConclusionEmbedding = [0.3, 0.4, 0.5] satisfies TextEmbedding;
    const secondIntroductionEmbedding = [0.4, 0.5, 0.6] satisfies TextEmbedding;
    const secondMainBodyEmbedding = [0.5, 0.6, 0.7] satisfies TextEmbedding;
    const secondConclusionEmbedding = [0.6, 0.7, 0.8] satisfies TextEmbedding;
    const thirdIntroductionEmbedding = [0.7, 0.8, 0.9] satisfies TextEmbedding;
    const thirdMainBodyEmbedding = [0.8, 0.9, 1] satisfies TextEmbedding;
    const thirdConclusionEmbedding = [0.9, 1, 1.1] satisfies TextEmbedding;
    const request = createRequest<ScrapedJob & { x: number }>({
      body: { ...createJob<ScrapedJob>(), x: 2 },
    });
    const { response, status, json } = createResponse();

    toArray.mockResolvedValue([
      createStoredCoverLetter(
        firstIntroductionEmbedding,
        firstMainBodyEmbedding,
        firstConclusionEmbedding,
        'first',
        'id-first',
      ),
      createStoredCoverLetter(
        secondIntroductionEmbedding,
        secondMainBodyEmbedding,
        secondConclusionEmbedding,
        'second',
        'id-second',
      ),
      createStoredCoverLetter(
        thirdIntroductionEmbedding,
        thirdMainBodyEmbedding,
        thirdConclusionEmbedding,
        'third',
        'id-third',
      ),
    ]);

    for (const v of [0.2, 0.3, 0.4, 0.8, 0.9, 1, 0.5, 0.6, 0.7])
      calculateCosineSimilarity.mockReturnValueOnce(v);

    await getTopXSimilarCoverLetters(request, response);

    const expectedEmbeddings = [
      firstIntroductionEmbedding,
      firstMainBodyEmbedding,
      firstConclusionEmbedding,
      secondIntroductionEmbedding,
      secondMainBodyEmbedding,
      secondConclusionEmbedding,
      thirdIntroductionEmbedding,
      thirdMainBodyEmbedding,
      thirdConclusionEmbedding,
    ];
    for (const [i, embedding] of expectedEmbeddings.entries()) {
      expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(
        i + 1,
        jobEmbedding,
        embedding,
      );
    }
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      coverLetterIds: ['id-second', 'id-third'],
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns an empty result when no cover letters exist', async () => {
    const request = createRequest<ScrapedJob & { x: number }>({
      body: { ...createJob<ScrapedJob>(), x: 3 },
    });
    const { response, status, json } = createResponse();

    await getTopXSimilarCoverLetters(request, response);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ coverLetterIds: [] });
    expect(calculateCosineSimilarity).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the request body is invalid', async () => {
    const request = createRequest<ScrapedJob & { x: number }>({
      body: { x: 2 } as unknown as ScrapedJob & { x: number },
    });
    const { response, status, json } = createResponse();

    await getTopXSimilarCoverLetters(request, response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error:
        'Request body must include a valid job embedding and a positive number x',
      message: 'An error occurred while processing the request',
    });
    expect(connect).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });
});
