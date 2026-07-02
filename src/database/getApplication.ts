// fallow-ignore-file security-sink
// The two path.resolve() calls below (cv.filePath, certificate.filePath) are
// gated by isPathInside() before use — see src/utils/isPathInside.ts for the
// mitigation. Both filePath values originate from multer-generated
// filenames (uploadCV.ts, uploadCertificates.ts), not raw user input.
// Verified 2026-07.
import type { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { MongoClient, ObjectId, type WithId } from 'mongodb';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import puppeteer from 'puppeteer';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { isPathInside } from '../utils/isPathInside.js';
import type {
  CoverLetterSegmentName,
  StoredCertificate,
  StoredCoverLetter,
  StoredCv,
  StoredScrapedJob,
  StoredUser,
} from '#types';
import {
  connectionStringConfigured,
  cvNotFoundError,
  findJobAndCvByDuplicateKey,
  getCollection,
  jobNotFoundError,
  MONGODB_CONNECTION,
} from './database.js';

const USER_ID = new ObjectId('6a3d03b1dba1b11cee01161c');

const coverLetterNotFoundError = new Error('Cover letter not found');

const BODY_SEGMENT_ORDER: CoverLetterSegmentName[] = [
  'salutation',
  'introduction',
  'mainBody',
  'conclusion',
  'greetings',
];

const coverLetterTemplate = readFileSync(
  new URL('./coverLetter.html', import.meta.url),
  'utf-8',
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function coverLetterToHtml(
  coverLetter: StoredCoverLetter,
  job: StoredScrapedJob,
  user: StoredUser,
): string {
  const date = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const bodyParas = BODY_SEGMENT_ORDER.flatMap((name) =>
    coverLetter[name].text ? coverLetter[name].text.split('\n\n') : [],
  )
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return coverLetterTemplate
    .replace(/\{\{userName\}\}/g, () => escapeHtml(user.name))
    .replace(/\{\{userStreetAddress\}\}/g, () =>
      escapeHtml(user.address.streetAddress),
    )
    .replace(/\{\{userPostalCode\}\}/g, () =>
      escapeHtml(user.address.postalCode),
    )
    .replace(/\{\{userCity\}\}/g, () => escapeHtml(user.address.city))
    .replace(/\{\{userTel\}\}/g, () => escapeHtml(user.tel))
    .replace(/\{\{userEmail\}\}/g, () => escapeHtml(user.email))
    .replace(/\{\{jobCompany\}\}/g, () => escapeHtml(job.company))
    .replace(/\{\{jobStreetAddress\}\}/g, () =>
      escapeHtml(job.companyAddress.streetAddress),
    )
    .replace(/\{\{jobPostalCode\}\}/g, () =>
      escapeHtml(job.companyAddress.postalCode),
    )
    .replace(/\{\{jobCity\}\}/g, () => escapeHtml(job.companyAddress.city))
    .replace(/\{\{date\}\}/g, () => escapeHtml(date))
    .replace(/\{\{subject\}\}/g, () => escapeHtml(coverLetter.subject.text))
    .replace(/\{\{bodyParas\}\}/g, () => bodyParas);
}

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

  const { job, cv } = await findJobAndCvByDuplicateKey(client, jobDuplicateKey);

  const user = await getCollection<StoredUser>(client, 'users').findOne({
    _id: USER_ID,
  });
  if (!user) throw new Error('User not found');

  return { coverLetter, job, cv, user };
}

async function renderCoverLetterPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4' });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
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
  if (!connectionStringConfigured(response)) return;

  const { jobDuplicateKey } = request.params;

  const client = new MongoClient(MONGODB_CONNECTION!);
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
