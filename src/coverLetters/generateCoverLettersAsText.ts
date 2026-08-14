import type { ScrapedJob, StoredCoverLetter } from '#types';
import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
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

    const client = new MongoClient(MONGODB_CONNECTION!);

    try {
        await client.connect();
        const storedCoverLetters = await getCollection<StoredCoverLetter>(
            client,
            'coverLetters',
        )
            .find()
            .toArray();

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

        res.status(200).json({
            coverLetter: reconstructCoverLetterText(
                getGeneratorCoverLetterTextSegments(generated),
            ),
        });
    } catch (error) {
        createErrorMessage(res, error, 'Error generating cover letter', 500);
    } finally {
        await client.close();
    }
}
