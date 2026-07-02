import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import {
  connectionStringConfigured,
  findJobIdByDuplicateKey,
  getCollection,
  jobNotFoundError,
  MONGODB_CONNECTION,
} from './database.js';
import type { StoredCertificate } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';

export default async function getCertificatesStatus(
  request: Request<{ jobDuplicateKey: string }>,
  response: Response,
): Promise<void> {
  if (!connectionStringConfigured(response)) return;

  const { jobDuplicateKey } = request.params;
  const certificatesNotFoundError = new Error('Certificates not found');

  let client: MongoClient | undefined;
  try {
    client = new MongoClient(MONGODB_CONNECTION!);
    await client.connect();

    const job = await findJobIdByDuplicateKey(client, jobDuplicateKey);

    const certificate = await getCollection<StoredCertificate>(
      client,
      'certificates',
    ).findOne({ jobId: job._id.toHexString() }, { projection: { _id: 1 } });
    if (!certificate) throw certificatesNotFoundError;

    response.status(200).json({ message: 'Certificates exist' });
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Error checking certificates status',
      error === jobNotFoundError || error === certificatesNotFoundError
        ? 404
        : 500,
    );
  } finally {
    await client?.close();
  }
}
