import type {
  StoredCertificate,
  StoredCoverLetter,
  StoredCv,
  StoredScrapedJob,
  StoredUser,
} from '#types';
import type { Response } from 'express';
import { ObjectId, type MongoClient, type WithId } from 'mongodb';

export const MONGODB_CONNECTION = process.env['MONGODB_CONNECTION_STRING'];

// Hardcoded because there's no auth/multi-tenancy yet — every request acts as this user.
export const USER_ID = new ObjectId('6a3d03b1dba1b11cee01161c');

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
export const cvNotFoundError = new Error('CV not found');

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

export async function findJobAndCvByDuplicateKey(
  client: MongoClient,
  duplicateKey: string,
): Promise<{ job: WithId<StoredScrapedJob>; cv: StoredCv }> {
  const job = await findJobByDuplicateKey(client, duplicateKey);

  const cv = await getCollection<StoredCv>(client, 'cv').findOne({
    jobId: job._id.toHexString(),
  });
  if (!cv) throw cvNotFoundError;

  return { job, cv };
}

export async function findJobIdByDuplicateKey(
  client: MongoClient,
  duplicateKey: string,
): Promise<WithId<StoredScrapedJob>> {
  const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne(
    { duplicateKey },
    { projection: { _id: 1 } },
  );
  if (!job) throw jobNotFoundError;
  return job;
}
