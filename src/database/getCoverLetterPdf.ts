import type { Request, Response } from 'express';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import type { StoredCoverLetter } from '#types';
import { findUserProfile } from './userProfile.js';
import { handleKnownCoverLetterPdfError } from './handleKnownCoverLetterPdfError.js';
import {
    coverLetterToHtml,
    renderCoverLetterPdf,
} from './coverLetterPdf.js';
import {
    createDatabaseClient,
    findJobByDuplicateKey,
    getCollection,
    jobNotFoundError,
} from './database.js';

const coverLetterNotFoundError = new Error('Cover letter not found');

export default async function getCoverLetterPdf(
    request: Request<{ jobDuplicateKey: string }>,
    response: Response,
): Promise<void> {
    const { jobDuplicateKey } = request.params;

    const client = createDatabaseClient(response);
    if (!client) return;

    try {
        await client.connect();

        const coverLetter = await getCollection<StoredCoverLetter>(
            client,
            'coverLetters',
        ).findOne({ jobDuplicateKey });
        if (!coverLetter) throw coverLetterNotFoundError;

        const job = await findJobByDuplicateKey(client, jobDuplicateKey);

        const user = await findUserProfile(client);

        const html = coverLetterToHtml(coverLetter, job, user);
        const pdfBytes = await renderCoverLetterPdf(html);

        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader(
            'Content-Disposition',
            'attachment; filename="cover-letter.pdf"',
        );
        response.end(Buffer.from(pdfBytes));
    } catch (error) {
        if (handleKnownCoverLetterPdfError(response, error)) return;
        const missingRecordError = [
            coverLetterNotFoundError,
            jobNotFoundError,
        ].find((sentinel) => sentinel === error);
        createErrorMessage(
            response,
            error,
            'Error retrieving cover letter',
            missingRecordError ? 404 : 500,
            missingRecordError?.message,
        );
    } finally {
        await client.close();
    }
}
