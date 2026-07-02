import type {
  StoredCertificate,
  StoredCoverLetter,
  StoredCv,
  StoredScrapedJob,
  StoredUser,
} from '#types';
import type { Response } from 'express';
import type { MongoClient, WithId } from 'mongodb';

export const MONGODB_CONNECTION = process.env['MONGODB_CONNECTION_STRING'];

export function getCollection<
  T extends
    | StoredCertificate
    | StoredCoverLetter
    | StoredScrapedJob
    | StoredCv
    | StoredUser,
>(
  client: MongoClient,
  collectionName: 'certificates' | 'coverLetters' | 'jobs' | 'cv' | 'users',
) {
  return client.db('jobMatch').collection<T>(collectionName);
}

export function connectionStringConfigured(response: Response) {
  if (!MONGODB_CONNECTION) {
    response
      .status(500)
      .json({ message: 'MongoDB connection string is not configured' });
    return false;
  }
  return true;
}

export const jobNotFoundError = new Error('Job not found');

export async function findJobByDuplicateKey(
  client: MongoClient,
  duplicateKey: string,
): Promise<WithId<StoredScrapedJob>> {
  const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne({
    duplicateKey,
  });
  if (!job) throw jobNotFoundError;
  return job;
}
