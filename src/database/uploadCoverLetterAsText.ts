import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  MONGODB_CONNECTION,
} from './database.js';
import type { CoverLetterAsTextRequestBody } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { toStoredCoverLetterDraft } from '../coverLetters/coverLetterDraft.js';
import { storeCoverLetter } from './storeCoverLetter.js';

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
      invalidCoverLetterAsTextRequestBodyError.message,
    );
    return;
  }

  const { coverLetterText, jobDuplicateKey } = request.body;
  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    const coverLetter = toStoredCoverLetterDraft(coverLetterText);
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
