import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import {
    connectionStringConfigured,
    findJobByDuplicateKey,
    getCollection,
    jobNotFoundError,
    MONGODB_CONNECTION,
} from './database.js';
import type { StoredCertificate } from '#types';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { fileContentMatchesMimetype } from '../utils/verifyFileContentType.js';
import { UploadFileOwnership } from './uploadFileCleanup.js';

// Returns the first uploaded file whose on-disk content doesn't match its
// declared mimetype, or undefined if every file is valid. Split out of
// uploadCertificates so the caller's error-handling/cleanup branches don't
// also carry this function's own branching (fallow health/#64).
async function findInvalidCertificateFile(
    files: Express.Multer.File[],
): Promise<Express.Multer.File | undefined> {
    const fileValidities = await Promise.allSettled(
        files.map(async (file) => ({
            file,
            valid: await fileContentMatchesMimetype(file.path, file.mimetype),
        })),
    );
    const failedRead = fileValidities.find(
        (entry) => entry.status === 'rejected',
    );
    if (failedRead) throw failedRead.reason;
    return fileValidities
        .filter((entry) => entry.status === 'fulfilled')
        .find((entry) => !entry.value.valid)?.value.file;
}

export default async function uploadCertificates(
    request: Request,
    response: Response,
): Promise<void> {
    const files = Array.isArray(request.files) ? request.files : [];
    const ownership = new UploadFileOwnership(files.map((file) => file.path));
    let client: MongoClient | undefined;
    try {
        const jobDuplicateKey = request.body?.['jobDuplicateKey'] as unknown;
        if (!connectionStringConfigured(response)) return;
        if (typeof jobDuplicateKey !== 'string') {
            createErrorMessage(
                response,
                new Error('jobDuplicateKey must be a string'),
                'Error uploading certificates',
                400,
            );
            return;
        }
        if (files.length === 0) {
            createErrorMessage(
                response,
                new Error('At least one file is required'),
                'Error uploading certificates',
                400,
            );
            return;
        }
        const invalidFile = await findInvalidCertificateFile(files);
        if (invalidFile) {
            createErrorMessage(
                response,
                new Error(
                    `File "${invalidFile.originalname}" is not a valid PDF, JPEG, or PNG file`,
                ),
                'Error uploading certificates',
                400,
            );
            return;
        }

        client = new MongoClient(MONGODB_CONNECTION!);
        await client.connect();
        const job = await findJobByDuplicateKey(client, jobDuplicateKey);
        const docs: StoredCertificate[] = files.map((file) => ({
            jobId: job._id.toHexString(),
            filePath: file.path,
            originalName: file.originalname,
            mimeType: file.mimetype,
        }));
        const collection = getCollection<StoredCertificate>(
            client,
            'certificates',
        );
        const result = await ownership.persist(collection, () =>
            collection.insertMany(docs, { ordered: true }),
        );
        response.status(201).json({
            message: 'Certificates uploaded',
            certificateIds: Object.values(result.insertedIds),
        });
    } catch (error) {
        createErrorMessage(
            response,
            error,
            'Error uploading certificates',
            error === jobNotFoundError ? 404 : 500,
        );
    } finally {
        await ownership.cleanup();
        await client?.close();
    }
}
