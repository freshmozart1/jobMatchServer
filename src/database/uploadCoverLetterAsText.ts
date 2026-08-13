import type { Request, Response } from 'express';
import { segmentCoverLetter } from 'cover-letter-generator';
import { createStoredCoverLetterFromTextSegments } from '../coverLetters/coverLetterEmbeddings.js';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from './database.js';
import type { StoredCoverLetter } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';

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
    await client.connect();
    const coverLettersCollection = getCollection<StoredCoverLetter>(
      client,
      'coverLetters',
    );
    const { segments } = await segmentCoverLetter(coverLetterText);
    const coverLetter = await createStoredCoverLetterFromTextSegments(segments);

    if (jobDuplicateKey) {
      const upserted = await coverLettersCollection.findOneAndReplace(
        { jobDuplicateKey },
        { ...coverLetter, jobDuplicateKey },
        { upsert: true, returnDocument: 'after' },
      );
      response
        .status(201)
        .json({
          message: 'Cover letter uploaded',
          coverLetterId: upserted?._id,
        });
    } else {
      const result = await coverLettersCollection.insertOne(coverLetter);
      response
        .status(201)
        .json({
          message: 'Cover letter uploaded',
          coverLetterId: result.insertedId,
        });
    }
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'An error occurred while uploading the cover letter',
    );
  } finally {
    await client.close();
  }
}
