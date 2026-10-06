import type { Request, Response } from 'express';
import { MongoClient, type Collection } from 'mongodb';
import {
    connectionStringConfigured,
    findJobByDuplicateKey,
    getCollection,
    jobNotFoundError,
    MONGODB_CONNECTION,
} from './database.js';
import type { StoredCv } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { fileContentMatchesMimetype } from '../utils/verifyFileContentType.js';
import { withCvRetirementLease } from './cvFileAccess.js';
import {
    removeSupersededCv,
    UploadFileOwnership,
} from './uploadFileCleanup.js';

async function replaceCv(
    collection: Collection<StoredCv>,
    upload: { jobId: string; filePath: string; jobDuplicateKey: string },
    ownership: UploadFileOwnership,
): Promise<unknown> {
    const { jobId, filePath, jobDuplicateKey } = upload;
    const result = await ownership.persist(collection, () =>
        collection.findOneAndReplace(
            { jobId },
            { jobId, filePath },
            {
                upsert: true,
                returnDocument: 'before',
                includeResultMetadata: true,
            },
        ),
    );
    await withCvRetirementLease(jobDuplicateKey, () =>
        removeSupersededCv(collection, result.value?.filePath, filePath),
    );
    return result.value?._id ?? result.lastErrorObject?.['upserted'];
}

export default async function uploadCV(
    request: Request,
    response: Response,
): Promise<void> {
    const ownership = new UploadFileOwnership(
        request.file ? [request.file.path] : [],
    );
    let client: MongoClient | undefined;
    try {
        const jobDuplicateKey = request.body?.['jobDuplicateKey'] as unknown;
        if (!connectionStringConfigured(response)) return;
        if (typeof jobDuplicateKey !== 'string') {
            createErrorMessage(
                response,
                new Error('jobDuplicateKey must be a string'),
                'Error uploading CV',
                400,
            );
            return;
        }
        if (!request.file) {
            createErrorMessage(
                response,
                new Error('file is required'),
                'Error uploading CV',
                400,
            );
            return;
        }
        if (
            !(await fileContentMatchesMimetype(
                request.file.path,
                request.file.mimetype,
            ))
        ) {
            createErrorMessage(
                response,
                new Error('file must be a PDF'),
                'Error uploading CV',
                400,
            );
            return;
        }

        client = new MongoClient(MONGODB_CONNECTION!);
        await client.connect();
        const job = await findJobByDuplicateKey(client, jobDuplicateKey);
        const jobId = job._id.toHexString();
        const cvId = await replaceCv(
            getCollection<StoredCv>(client, 'cv'),
            { jobId, filePath: request.file.path, jobDuplicateKey },
            ownership,
        );
        response.status(201).json({ message: 'CV uploaded', cvId });
    } catch (error) {
        createErrorMessage(
            response,
            error,
            'Error uploading CV',
            error === jobNotFoundError ? 404 : 500,
        );
    } finally {
        await ownership.cleanup();
        await client?.close();
    }
}
