import type { Request, Response } from 'express';
import {
  type StoredCoverLetter,
  type TextEmbedding,
  type ScrapedJob,
} from '#types';
import { MongoClient } from 'mongodb';
import calculateCosineSimilarity from '../embeddings/calculateCosineSimilarity.js';
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from './database.js';
import { createErrorMessage } from '../errors/createErrorMessage.js';

type GetTopXSimilarCoverLettersRequestBody = ScrapedJob & { x: number };

const SEGMENT_SIMILARITY_WEIGHTS = {
  subject: 0.06,
  salutation: 0.02,
  introduction: 0.2,
  mainBody: 0.5,
  conclusion: 0.2,
  greetings: 0.02,
};

function calculateWeightedCoverLetterSimilarity(
  jobEmbedding: TextEmbedding,
  coverLetter: StoredCoverLetter,
): number {
  let weightedSimilaritySum = 0;
  let appliedWeightSum = 0;

  for (const [segmentName, weight] of Object.entries(
    SEGMENT_SIMILARITY_WEIGHTS,
  )) {
    const embedding =
      coverLetter[segmentName as keyof typeof SEGMENT_SIMILARITY_WEIGHTS]
        .embedding;

    if (!embedding) continue;

    weightedSimilaritySum +=
      calculateCosineSimilarity(jobEmbedding, embedding) * weight;
    appliedWeightSum += weight;
  }

  return appliedWeightSum === 0 ? 0 : weightedSimilaritySum / appliedWeightSum;
}

function isValidGetTopXSimilarCoverLettersRequestBody(
  body: unknown,
): body is GetTopXSimilarCoverLettersRequestBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    'embedding' in body &&
    Array.isArray(body.embedding) &&
    body.embedding.length > 0 &&
    body.embedding.every((v) => typeof v === 'number') &&
    'x' in body &&
    typeof body.x === 'number' &&
    Number.isInteger(body.x) &&
    body.x > 0
  );
}

export default async function getTopXSimilarCoverLetters(
  request: Request<object, object, GetTopXSimilarCoverLettersRequestBody>,
  response: Response,
): Promise<void> {
  if (!connectionStringConfigured(response)) return;

  if (!isValidGetTopXSimilarCoverLettersRequestBody(request.body)) {
    createErrorMessage(
      response,
      new Error(
        'Request body must include a valid job embedding and a positive number x',
      ),
      'An error occurred while processing the request',
      400,
    );
    return;
  }

  const { embedding, x } = request.body;

  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    await client.connect();
    const coverLetterIds = (
      await getCollection<StoredCoverLetter>(client, 'coverLetters')
        .find()
        .toArray()
    )
      .map((cl) => ({
        id: cl._id.toString(),
        similarity: calculateWeightedCoverLetterSimilarity(embedding, cl),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, x)
      .map(({ id }) => id);

    response.status(200).json({ coverLetterIds });
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'An error occurred while processing the request',
      500,
    );
  } finally {
    await client.close();
  }
}
