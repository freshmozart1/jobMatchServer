import type { Request, Response } from 'express';
import type { CreateJobInDatabaseRequestBody, StoredScrapedJob } from '#types';
import { MongoClient } from 'mongodb';
import {
    connectionStringConfigured,
    getCollection,
    MONGODB_CONNECTION,
} from './database.js';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import isValidCreateJobRequestBody from './createJobRequest.js';

export default async function createJobInDatabase(
    request: Request<object, object, CreateJobInDatabaseRequestBody>,
    response: Response,
): Promise<void> {
    const invalidBodyErrorMessage =
        'Request body must include a valid job (including a non-empty string duplicateKey and finite numeric embedding) and a boolean like field';

    if (!isValidCreateJobRequestBody(request.body)) {
        response.status(400).json({
            message: invalidBodyErrorMessage,
            error: invalidBodyErrorMessage,
        });
        return;
    }

    if (!connectionStringConfigured(response)) return;

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
        response
            .status(201)
            .json({ message: 'Job created', jobId: result?._id });
    } catch (error) {
        createErrorMessage(response, error, 'Failed to create job in database');
    } finally {
        await client.close();
    }
}
