// fallow-ignore-file security-sink
// The two path.resolve() calls below (cv.filePath, certificate.filePath) are
// gated by isPathInside() before use — see src/utils/isPathInside.ts for the
// mitigation. Both filePath values originate from multer-generated
// filenames (uploadCV.ts, uploadCertificates.ts), not raw user input.
// Verified 2026-07.
import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import type { MongoClient, WithId } from 'mongodb';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { isPathInside } from '../utils/isPathInside.js';
import type {
    StoredCertificate,
    StoredCoverLetter,
    StoredCv,
    StoredScrapedJob,
    StoredUser,
} from '#types';
import { coverLetterToHtml, renderCoverLetterPdf } from './coverLetterPdf.js';
import {
    createDatabaseClient,
    cvNotFoundError,
    findJobAndCvByDuplicateKey,
    getCollection,
    jobNotFoundError,
    USER_ID,
} from './database.js';

const coverLetterNotFoundError = new Error('Cover letter not found');

type ApplicationRecords = {
    coverLetter: WithId<StoredCoverLetter>;
    job: WithId<StoredScrapedJob>;
    cv: StoredCv;
    user: StoredUser;
};

async function loadApplicationRecords(
    client: MongoClient,
    jobDuplicateKey: string,
): Promise<ApplicationRecords> {
    const coverLetter = await getCollection<StoredCoverLetter>(
        client,
        'coverLetters',
    ).findOne({ jobDuplicateKey });
    if (!coverLetter) throw coverLetterNotFoundError;

    const { job, cv } = await findJobAndCvByDuplicateKey(
        client,
        jobDuplicateKey,
    );

    const user = await getCollection<StoredUser>(client, 'users').findOne({
        _id: USER_ID,
    });
    if (!user) throw new Error('User not found');

    return { coverLetter, job, cv, user };
}

async function mergeCertificatesIntoPdf(
    merged: PDFDocument,
    safeCertificates: StoredCertificate[],
): Promise<void> {
    for (const certificate of safeCertificates) {
        try {
            const certificateBytes = await readFile(
                path.resolve(certificate.filePath),
            );
            if (certificate.mimeType === 'application/pdf') {
                const certDoc = await PDFDocument.load(certificateBytes);
                for (const p of await merged.copyPages(
                    certDoc,
                    certDoc.getPageIndices(),
                ))
                    merged.addPage(p);
            } else if (
                certificate.mimeType === 'image/jpeg' ||
                certificate.mimeType === 'image/jpg'
            ) {
                const img = await merged.embedJpg(certificateBytes);
                const certPage = merged.addPage([595.28, 841.89]);
                certPage.drawImage(img, {
                    x: 0,
                    y: 0,
                    width: 595.28,
                    height: 841.89,
                });
            } else if (certificate.mimeType === 'image/png') {
                const img = await merged.embedPng(certificateBytes);
                const certPage = merged.addPage([595.28, 841.89]);
                certPage.drawImage(img, {
                    x: 0,
                    y: 0,
                    width: 595.28,
                    height: 841.89,
                });
            }
        } catch {
            continue;
        }
    }
}

export default async function getApplication(
    request: Request<{ jobDuplicateKey: string }>,
    response: Response,
): Promise<void> {
    const { jobDuplicateKey } = request.params;

    const client = createDatabaseClient(response);
    if (!client) return;

    try {
        await client.connect();

        const { coverLetter, job, cv, user } = await loadApplicationRecords(
            client,
            jobDuplicateKey,
        );

        if (!isPathInside('uploads/cv', cv.filePath)) {
            createErrorMessage(
                response,
                new Error('Invalid file path'),
                'Error retrieving application',
                500,
            );
            return;
        }
        const resolvedPath = path.resolve(cv.filePath);

        // Certificates are optional: a job without certificates still produces a
        // valid application PDF. Any certificate that cannot be embedded (unsafe
        // path, non-renderable image, or corrupt file) is skipped, never fatal.
        const certificates = await getCollection<StoredCertificate>(
            client,
            'certificates',
        )
            .find({ jobId: job._id.toHexString() })
            .toArray();
        const safeCertificates = certificates.filter((certificate) =>
            isPathInside('uploads/certificates', certificate.filePath),
        );

        const html = coverLetterToHtml(coverLetter, job, user);
        const coverLetterPdfBytes = await renderCoverLetterPdf(html);

        const cvBytes = await readFile(resolvedPath);

        const merged = await PDFDocument.create();

        const clDoc = await PDFDocument.load(coverLetterPdfBytes);
        for (const p of await merged.copyPages(clDoc, clDoc.getPageIndices()))
            merged.addPage(p);

        const cvDoc = await PDFDocument.load(cvBytes);
        for (const p of await merged.copyPages(cvDoc, cvDoc.getPageIndices()))
            merged.addPage(p);

        await mergeCertificatesIntoPdf(merged, safeCertificates);

        const mergedBytes = await merged.save();

        response.setHeader('Content-Type', 'application/pdf');
        response.setHeader(
            'Content-Disposition',
            'attachment; filename="application.pdf"',
        );
        response.end(Buffer.from(mergedBytes));
    } catch (error) {
        createErrorMessage(
            response,
            error,
            'Error retrieving application',
            error === coverLetterNotFoundError ||
                error === jobNotFoundError ||
                error === cvNotFoundError
                ? 404
                : 500,
        );
    } finally {
        await client.close();
    }
}
