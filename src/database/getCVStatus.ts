import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  cvNotFoundError,
  findJobIdByDuplicateKey,
  getCollection,
  jobNotFoundError,
  MONGODB_CONNECTION,
} from './database.js';
import type { StoredCv } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';

export default async function getCVStatus(
  request: Request<{ jobDuplicateKey: string }>,
  response: Response,
): Promise<void> {
  if (!connectionStringConfigured(response)) return;

  const { jobDuplicateKey } = request.params;

  let client: MongoClient | undefined;
  try {
    client = new MongoClient(MONGODB_CONNECTION!);
    await client.connect();
    const job = await findJobIdByDuplicateKey(client, jobDuplicateKey);

    const cv = await getCollection<StoredCv>(client, 'cv').findOne(
      { jobId: job._id.toHexString() },
      { projection: { _id: 1 } },
    );
    if (!cv) throw cvNotFoundError;

    response.status(200).json({ message: 'CV exists' });
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Error checking CV status',
      error === jobNotFoundError || error === cvNotFoundError ? 404 : 500,
    );
  } finally {
    await client?.close();
  }
}
