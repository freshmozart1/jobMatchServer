import type { Request, Response } from 'express';
import {
  segmentCoverLetter,
  embedCoverLetterSegments,
} from 'cover-letter-generator';
import { MongoClient, type ObjectId } from 'mongodb';
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from './database.js';
import type { StoredCoverLetter } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { toStoredCoverLetter } from '../coverLetters/coverLetterAdapters.js';

type CoverLetterAsTextRequestBody = {
  coverLetterText: string;
  jobDuplicateKey?: string;
};

function isValidCoverLetterAsTextRequestBody(
  body: unknown,
): body is CoverLetterAsTextRequestBody {
  if (typeof body !== 'object' || body === null) return false;
  if (
    !('coverLetterText' in body) ||
    typeof body.coverLetterText !== 'string' ||
    body.coverLetterText.trim().length === 0
  )
    return false;
  if (
    'jobDuplicateKey' in body &&
    (typeof body.jobDuplicateKey !== 'string' ||
      body.jobDuplicateKey.trim().length === 0)
  )
    return false;
  return true;
}

// Scoped to the one write the client serves, so the connection opens after
// segmentation and embedding instead of idling through those round trips.
async function storeCoverLetter(
  client: MongoClient,
  coverLetter: Omit<StoredCoverLetter, 'jobDuplicateKey'>,
  jobDuplicateKey: string | undefined,
): Promise<ObjectId | undefined> {
  try {
    await client.connect();
    const coverLettersCollection = getCollection<StoredCoverLetter>(
      client,
      'coverLetters',
    );

    if (jobDuplicateKey) {
      const upserted = await coverLettersCollection.findOneAndReplace(
        { jobDuplicateKey },
        { ...coverLetter, jobDuplicateKey },
        { upsert: true, returnDocument: 'after' },
      );
      return upserted?._id;
    }
    const result = await coverLettersCollection.insertOne(coverLetter);
    return result.insertedId;
  } finally {
    await client.close();
  }
}

export default async function uploadCoverLetterAsText(
  request: Request<object, object, CoverLetterAsTextRequestBody>,
  response: Response,
): Promise<void> {
  const invalidCoverLetterAsTextRequestBodyError = new Error(
    'Invalid request body. Please provide a non-empty coverLetterText string and a non-empty jobDuplicateKey string.',
  );

  if (!connectionStringConfigured(response)) return;

  if (!isValidCoverLetterAsTextRequestBody(request.body)) {
    createErrorMessage(
      response,
      invalidCoverLetterAsTextRequestBodyError,
      'An error occurred while uploading the cover letter',
      400,
    );
    return;
  }

  const { coverLetterText, jobDuplicateKey } = request.body;
  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    const { segments } = await segmentCoverLetter(coverLetterText);
    const coverLetter = toStoredCoverLetter(
      await embedCoverLetterSegments(segments),
    );
    const coverLetterId = await storeCoverLetter(
      client,
      coverLetter,
      jobDuplicateKey,
    );
    response
      .status(201)
      .json({
        message: 'Cover letter uploaded',
        coverLetterId,
      });
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'An error occurred while uploading the cover letter',
    );
  }
}
