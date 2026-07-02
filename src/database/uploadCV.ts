import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  findJobByDuplicateKey,
  getCollection,
  jobNotFoundError,
  MONGODB_CONNECTION,
} from './database.js';
import type { StoredCv } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';

export default async function uploadCV(
  request: Request,
  response: Response,
): Promise<void> {
  const jobDuplicateKey = request.body['jobDuplicateKey'] as unknown;
  const jobDuplicateKeyMustBeStringError = new Error(
    'jobDuplicateKey must be a string',
  );
  const fileRequiredError = new Error('file is required');
  const fileMustBePdfError = new Error('file must be a PDF');

  if (!connectionStringConfigured(response)) return;

  if (typeof jobDuplicateKey !== 'string') {
    createErrorMessage(
      response,
      jobDuplicateKeyMustBeStringError,
      'Error uploading CV',
      400,
    );
    return;
  }
  if (!request.file) {
    createErrorMessage(response, fileRequiredError, 'Error uploading CV', 400);
    return;
  }
  if (
    !(
      request.file.mimetype === 'application/pdf' ||
      request.file.originalname.toLowerCase().endsWith('.pdf')
    )
  ) {
    createErrorMessage(response, fileMustBePdfError, 'Error uploading CV', 400);
    return;
  }

  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    await client.connect();
    const job = await findJobByDuplicateKey(client, jobDuplicateKey);

    const upserted = await getCollection<StoredCv>(
      client,
      'cv',
    ).findOneAndReplace(
      { jobId: job._id.toHexString() },
      { jobId: job._id.toHexString(), filePath: request.file.path },
      { upsert: true, returnDocument: 'after' },
    );
    response.status(201).json({ message: 'CV uploaded', cvId: upserted?._id });
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Error uploading CV',
      error === jobNotFoundError ? 404 : 500,
    );
  } finally {
    await client.close();
  }
}
