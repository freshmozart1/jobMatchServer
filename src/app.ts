import express, {
    type NextFunction,
    type Request,
    type Response,
} from 'express';
import multer from 'multer';

import { scrapeJob } from '#scrapers/linkedin/scrapeJob.js';
import createJobInDatabase from '#database/createJobInDatabase.js';
import createUserProfile from '#database/createUserProfile.js';
import uploadCoverLetterAsText from '#database/uploadCoverLetterAsText.js';
import generateCoverLetterAsText from './coverLetters/generateCoverLettersAsText.js';
import reviseCoverLetterAsText from './coverLetters/reviseCoverLetterAsText.js';
import countTokens from './tokens/calculateTokens.js';
import uploadCV from '#database/uploadCV.js';
import getCV from '#database/getCV.js';
import getCVStatus from '#database/getCVStatus.js';
import uploadCertificates from '#database/uploadCertificates.js';
import getCertificatesStatus from '#database/getCertificatesStatus.js';
import getApplication from '#database/getApplication.js';
import getCoverLetterPdf from '#database/getCoverLetterPdf.js';
import { createErrorMessage } from './errors/createErrorMessage.js';
import isAllowedCvMimetype from './utils/isAllowedCvMimetype.js';
import isAllowedCertificateMimetype from './utils/isAllowedCertificateMimetype.js';
import createCorsMiddleware from './server/cors.js';
import handleUnhandledError from './server/errorHandler.js';

export const app = express();

app.use(createCorsMiddleware(process.env['CORS_ALLOWED_ORIGINS']));

app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request: Request, response: Response): void => {
    response.status(200).json({ status: 'ok' });
});

app.post('/scrape/linkedin', scrapeJob);

app.post('/jobs/create', createJobInDatabase);

app.post('/users/profile', createUserProfile);

app.post('/cover-letters/upload/text', uploadCoverLetterAsText);

app.get('/cover-letters/:jobDuplicateKey', getCoverLetterPdf);

class UploadFilterError extends Error {}

function handleUploadFilterError(customMessage: string) {
    return (
        error: unknown,
        _request: Request,
        response: Response,
        _next: NextFunction,
    ): void => {
        const publicError =
            error instanceof UploadFilterError ||
            error instanceof multer.MulterError
                ? error.message
                : undefined;
        createErrorMessage(response, error, customMessage, 400, publicError);
    };
}

const upload = multer({
    dest: 'uploads/cv',
    fileFilter: (
        _request: Request,
        file: Express.Multer.File,
        callback: multer.FileFilterCallback,
    ): void => {
        if (!isAllowedCvMimetype(file.mimetype)) {
            callback(new UploadFilterError('file must be a PDF'));
            return;
        }
        callback(null, true);
    },
});
app.post(
    '/cv/upload',
    upload.single('file'),
    handleUploadFilterError('Error uploading CV'),
    uploadCV,
);

app.get('/cv/:jobDuplicateKey', getCV);

app.get('/cv/:jobDuplicateKey/status', getCVStatus);

app.get('/certificates/:jobDuplicateKey/status', getCertificatesStatus);

const uploadCertificateFiles = multer({
    dest: 'uploads/certificates',
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (
        _request: Request,
        file: Express.Multer.File,
        callback: multer.FileFilterCallback,
    ): void => {
        if (!isAllowedCertificateMimetype(file.mimetype)) {
            callback(
                new UploadFilterError(
                    `file "${file.originalname}" is not a PDF, JPEG, or PNG`,
                ),
            );
            return;
        }
        callback(null, true);
    },
});
app.post(
    '/certificates/upload',
    uploadCertificateFiles.array('files', 10),
    handleUploadFilterError('Error uploading certificates'),
    uploadCertificates,
);

app.post('/cover-letters/create/text', generateCoverLetterAsText);

app.post('/cover-letters/revise/text', reviseCoverLetterAsText);

app.post('/tokens/count', countTokens);

app.get('/application/:jobDuplicateKey', getApplication);

// Also catches constructor failures before a handler's local try/catch and
// rejected async handlers. Keep this after every route and upload error filter.
app.use(handleUnhandledError);
