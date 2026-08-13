// fallow-ignore-file security-sink
// One flagged sink, verified 2026-07:
// - response.setHeader('Access-Control-Allow-Origin', origin): origin is
//   checked against ALLOWED_ORIGINS/LAN_ORIGIN_PATTERN before use (see the
//   CORS middleware below) — only a fixed allowlist of values ever reaches
//   the header.
import express, { type Request, type Response } from 'express';
import multer from 'multer';

import { scrapeJob } from '#scrapers/linkedin/scrapeJob.js';
import createJobInDatabase from '#database/createJobInDatabase.js';
import uploadCoverLetterAsText from '#database/uploadCoverLetterAsText.js';
import generateCoverLetterAsText from './coverLetters/generateCoverLettersAsText.js';
import countTokens from './tokens/calculateTokens.js';
import uploadCV from '#database/uploadCV.js';
import getCV from '#database/getCV.js';
import getCVStatus from '#database/getCVStatus.js';
import uploadCertificates from '#database/uploadCertificates.js';
import getCertificatesStatus from '#database/getCertificatesStatus.js';
import getApplication from '#database/getApplication.js';
import getCoverLetterPdf from '#database/getCoverLetterPdf.js';

export const app = express();

const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);
const LAN_ORIGIN_PATTERN = /^http:\/\/192\.168\.\d+\.\d+:5173$/;

app.use((request: Request, response: Response, next): void => {
    const origin = request.get('origin');

    if (
        origin &&
        (ALLOWED_ORIGINS.has(origin) || LAN_ORIGIN_PATTERN.test(origin))
    ) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
    }

    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        response.sendStatus(204);
        return;
    }

    next();
});

app.use(express.json({ limit: '64kb' }));

app.get('/health', (_request: Request, response: Response): void => {
    response.status(200).json({ status: 'ok' });
});

app.post('/scrape/linkedin', scrapeJob);

app.post('/jobs/create', createJobInDatabase);

app.post('/cover-letters/upload/text', uploadCoverLetterAsText);

app.get('/cover-letters/:jobDuplicateKey', getCoverLetterPdf);

//TODO: #26 Check if multer allows uploading any file and if it does, restrict it to only allow PDF files. Also, check if the file is actually a PDF and not just a file with a .pdf extension.
const upload = multer({ dest: `uploads/cv` });
app.post('/cv/upload', upload.single('file'), uploadCV);

app.get('/cv/:jobDuplicateKey', getCV);

app.get('/cv/:jobDuplicateKey/status', getCVStatus);

app.get('/certificates/:jobDuplicateKey/status', getCertificatesStatus);

//TODO #29
const uploadCertificateFiles = multer({
    dest: 'uploads/certificates',
    limits: { fileSize: 10 * 1024 * 1024 },
});
app.post(
    '/certificates/upload',
    uploadCertificateFiles.array('files', 10),
    uploadCertificates,
);

app.post('/cover-letters/create/text', generateCoverLetterAsText);

app.post('/tokens/count', countTokens);

app.get('/application/:jobDuplicateKey', getApplication);
