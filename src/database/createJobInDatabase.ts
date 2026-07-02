import type { Request, Response } from 'express';
import type { CreateJobInDatabaseRequestBody, StoredScrapedJob } from '#types';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from './database.js';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import {
  hasBooleanProp,
  hasObjectProp,
} from '../utils/requestBodyValidators.js';

function isValidCreateJobRequestBody(
  body: unknown,
): body is CreateJobInDatabaseRequestBody {
  return (
    typeof body === 'object' &&
    body !== null &&
    hasObjectProp(body, 'job') &&
    hasBooleanProp(body, 'like')
  );
}

export default async function createJobInDatabase(
  request: Request<object, object, CreateJobInDatabaseRequestBody>,
  response: Response,
): Promise<void> {
  const invalidBodyErrorMessage =
    'Request body must include job and boolean like fields';

  if (!connectionStringConfigured(response)) return;

  if (!isValidCreateJobRequestBody(request.body)) {
    response.status(400).json({
      message: invalidBodyErrorMessage,
      error: invalidBodyErrorMessage,
    });
    return;
  }

  const { job, like } = request.body;
  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    await client.connect();
    const result = await getCollection<StoredScrapedJob>(
      client,
      'jobs',
    ).findOneAndReplace(
      { duplicateKey: job.duplicateKey },
      { ...job, like },
      { upsert: true, returnDocument: 'after' },
    );
    response.status(201).json({ message: 'Job created', jobId: result?._id });
  } catch (error) {
    createErrorMessage(response, error, 'Failed to create job in database');
  } finally {
    await client.close();
  }
}
