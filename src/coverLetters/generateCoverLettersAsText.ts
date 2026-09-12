import type { ScrapedJob, StoredCoverLetter } from '#types';
import type { Request, Response } from 'express';
import { MongoClient, type WithId } from 'mongodb';
import {
    embedJob,
    generateCoverLetter,
    getTopXSimilarCoverLetters,
    type Job,
} from 'cover-letter-generator';
import {
    getGeneratorCoverLetterTextSegments,
    reconstructCoverLetterText,
    toGeneratorCoverLetter,
    toStoredCoverLetter,
} from './coverLetterAdapters.js';
import {
    connectionStringConfigured,
    getCollection,
    MONGODB_CONNECTION,
} from '#database/database.js';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import {
    hasOptionalPositiveIntegerProp,
    hasOptionalStringArrayProp,
    hasOptionalStringProp,
    hasStringProp,
} from '../utils/requestBodyValidators.js';
import { DeadlineExceededError, withDeadline } from '../utils/withDeadline.js';

export const GENERATE_COVER_LETTER_DEADLINE_MS = 5 * 60 * 1000;

type GenerateCoverLetterAsTextRequestBody = ScrapedJob & { x?: number };

function isValidScrapedJobBody(body: unknown): boolean {
    return (
        typeof body === 'object' &&
        body !== null &&
        hasStringProp(body, 'sourceHostname') &&
        hasStringProp(body, 'sourceUrl') &&
        hasStringProp(body, 'title') &&
        hasStringProp(body, 'company') &&
        hasOptionalStringProp(body, 'location') &&
        hasOptionalStringProp(body, 'descriptionText') &&
        hasOptionalStringProp(body, 'postedAt') &&
        hasStringProp(body, 'scrapedAt') &&
        hasOptionalStringArrayProp(body, 'tags') &&
        hasStringProp(body, 'duplicateKey')
    );
}

export function isValidGenerateCoverLetterAsTextRequestBody(
    body: unknown,
): body is GenerateCoverLetterAsTextRequestBody {
    return (
        isValidScrapedJobBody(body) &&
        typeof body === 'object' &&
        body !== null &&
        hasOptionalPositiveIntegerProp(body, 'x')
    );
}

// Scoped to the one read the client serves, so the connection is released
// before the embedding and generation round trips instead of idling (#136).
async function findStoredCoverLetters(
    client: MongoClient,
): Promise<WithId<StoredCoverLetter>[]> {
    try {
        await client.connect();
        return await getCollection<StoredCoverLetter>(client, 'coverLetters')
            .find()
            .toArray();
    } finally {
        await client.close();
    }
}

// Use a fresh, short-lived client for the post-generation write so no MongoDB
// connection remains open during the model round trips.
async function storeGeneratedCoverLetter(
    client: MongoClient,
    coverLetter: Omit<StoredCoverLetter, 'jobDuplicateKey'>,
    jobDuplicateKey: string,
): Promise<WithId<StoredCoverLetter>['_id'] | undefined> {
    try {
        await client.connect();
        const savedCoverLetter = await getCollection<StoredCoverLetter>(
            client,
            'coverLetters',
        ).findOneAndReplace(
            { jobDuplicateKey },
            { ...coverLetter, jobDuplicateKey },
            { upsert: true, returnDocument: 'after' },
        );
        return savedCoverLetter?._id;
    } finally {
        await client.close();
    }
}

export default async function generateCoverLetterAsText(
    req: Request<object, object, GenerateCoverLetterAsTextRequestBody>,
    res: Response,
): Promise<void> {
    if (!isValidGenerateCoverLetterAsTextRequestBody(req.body)) {
        createErrorMessage(
            res,
            '',
            'Invalid request body. Please provide all required fields with correct types.',
            400,
        );
        return;
    }

    const { x, ...jobData } = req.body;

    if (!connectionStringConfigured(res)) return;

    try {
        const result = await withDeadline(async () => {
            const readClient = new MongoClient(MONGODB_CONNECTION!);
            const storedCoverLetters = await findStoredCoverLetters(readClient);

            const packageCoverLetters = storedCoverLetters.map(
                toGeneratorCoverLetter,
            );

            const job: Job = {
                title: jobData.title,
                company: jobData.company,
                description: jobData.descriptionText ?? '',
                ...(jobData.location !== undefined
                    ? { location: jobData.location }
                    : {}),
            };

            const jobEmbedding = await embedJob(job);
            const matches = await getTopXSimilarCoverLetters(
                x ?? 3,
                jobEmbedding,
                packageCoverLetters,
            );
            const exampleSegments = matches.map(({ coverLetter }) =>
                getGeneratorCoverLetterTextSegments(coverLetter),
            );

            const generated = await generateCoverLetter(job, exampleSegments);
            const writeClient = new MongoClient(MONGODB_CONNECTION!);
            const coverLetterId = await storeGeneratedCoverLetter(
                writeClient,
                toStoredCoverLetter(generated),
                jobData.duplicateKey,
            );

            return {
                coverLetter: reconstructCoverLetterText(
                    getGeneratorCoverLetterTextSegments(generated),
                ),
                saved: true,
                coverLetterId,
            };
        }, GENERATE_COVER_LETTER_DEADLINE_MS);

        res.status(200).json(result);
    } catch (error) {
        if (error instanceof DeadlineExceededError) {
            createErrorMessage(
                res,
                error,
                'Cover letter generation deadline exceeded',
                504,
                'Request deadline exceeded',
            );
            return;
        }

        createErrorMessage(
            res,
            error,
            'Error generating cover letter',
            500,
            'Provider request failed',
        );
    }
}
