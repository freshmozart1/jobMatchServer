import type { MongoClient, ObjectId } from 'mongodb';
import type { StoredCoverLetter } from '#types';
import { getCollection } from './database.js';

// Release the write client before confirming autosave or generated-letter saves.
export async function storeCoverLetter(
    client: MongoClient,
    coverLetter: Omit<StoredCoverLetter, 'jobDuplicateKey'>,
    jobDuplicateKey: string | undefined,
): Promise<ObjectId | undefined> {
    try {
        await client.connect();
        const collection = getCollection<StoredCoverLetter>(
            client,
            'coverLetters',
        );
        if (jobDuplicateKey !== undefined) {
            const saved = await collection.findOneAndReplace(
                { jobDuplicateKey },
                { ...coverLetter, jobDuplicateKey },
                { upsert: true, returnDocument: 'after' },
            );
            return saved?._id;
        }
        const result = await collection.insertOne(coverLetter);
        return result.insertedId;
    } finally {
        await client.close();
    }
}
