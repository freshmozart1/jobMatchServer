import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { MongoClient, ObjectId } from 'mongodb';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import puppeteer from 'puppeteer';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import type {
  CoverLetterSegmentName,
  StoredCoverLetter,
  StoredCv,
  StoredScrapedJob,
  StoredUser,
} from '#types';
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from './database.js';

const USER_ID = new ObjectId('6a3d03b1dba1b11cee01161c');

const BODY_SEGMENT_ORDER: CoverLetterSegmentName[] = [
  'salutation',
  'introduction',
  'mainBody',
  'conclusion',
  'greetings',
];

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
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
  const e = escapeHtml;
  return `<!DOCTYPE html><html><head><style>
@page{size:A4;margin:0}*{box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:10pt;line-height:1.5;position:relative;width:210mm;height:297mm;margin:0;padding:0}
.header{position:absolute;left:0;top:0;width:210mm;height:27mm;text-align:right;padding:5mm 20mm 0}
.header-name{font-size:11pt;font-weight:bold}
.header-addr{font-size:9pt}
.address-window{position:absolute;left:20mm;top:27mm;width:85mm;height:45mm}
.absenderzeile{font-size:6pt;height:5mm;white-space:nowrap;overflow:hidden}
.recipient p{margin:0;line-height:1.4}
.reference{position:absolute;left:125mm;top:32mm;width:75mm;font-size:9pt;text-align:right}
.reference p{margin:0}
.subject{position:absolute;left:25mm;top:94.75mm;right:20mm;font-weight:bold}
.body{position:absolute;left:25mm;top:107mm;right:20mm;bottom:37mm;overflow:hidden}
.body p{margin:0 0 1em}
</style></head><body>\
<div class="header"><div class="header-name">${e(user.name)}</div><div class="header-addr">${e(user.address.streetAddress)} · ${e(user.address.postalCode)} ${e(user.address.city)}</div></div>\
<div class="address-window"><div class="absenderzeile">${e(user.name)} · ${e(user.address.streetAddress)} · ${e(user.address.postalCode)} ${e(user.address.city)}</div><div class="recipient"><p>${e(job.company)}</p><p>${e(job.companyAddress.streetAddress)}</p><p>${e(job.companyAddress.postalCode)} ${e(job.companyAddress.city)}</p></div></div>\
<div class="reference"><p>${e(date)}</p><p>${e(user.tel)}</p><p>${e(user.email)}</p></div>\
<div class="subject">${e(coverLetter.subject.text)}</div>\
<div class="body">${bodyParas}</div>\
</body></html>`;
}

export default async function getApplication(
  request: Request<{ jobDuplicateKey: string }>,
  response: Response,
): Promise<void> {
  if (!connectionStringConfigured(response)) return;

  const { jobDuplicateKey } = request.params;
  const coverLetterNotFoundError = new Error('Cover letter not found');
  const jobNotFoundError = new Error('Job not found');
  const cvNotFoundError = new Error('CV not found');

  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    await client.connect();

    const coverLetter = await getCollection<StoredCoverLetter>(
      client,
      'coverLetters',
    ).findOne({ jobDuplicateKey });
    if (!coverLetter) throw coverLetterNotFoundError;

    const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne({
      duplicateKey: jobDuplicateKey,
    });
    if (!job) throw jobNotFoundError;

    const cv = await getCollection<StoredCv>(client, 'cv').findOne({
      jobId: job._id.toHexString(),
    });
    if (!cv) throw cvNotFoundError;

    const user = await getCollection<StoredUser>(client, 'users').findOne({
      _id: USER_ID,
    });
    if (!user) throw new Error('User not found');

    const uploadsDir = path.resolve('uploads/cv');
    const resolvedPath = path.resolve(cv.filePath);
    const relativePath = path.relative(uploadsDir, resolvedPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      createErrorMessage(
        response,
        new Error('Invalid file path'),
        'Error retrieving application',
        500,
      );
      return;
    }

    const html = coverLetterToHtml(coverLetter, job, user);

    const browser = await puppeteer.launch({ headless: true });
    let coverLetterPdfBytes: Uint8Array;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      coverLetterPdfBytes = await page.pdf({ format: 'A4' });
    } finally {
      await browser.close();
    }

    const cvBytes = await readFile(resolvedPath);

    const merged = await PDFDocument.create();

    const clDoc = await PDFDocument.load(coverLetterPdfBytes);
    for (const p of await merged.copyPages(clDoc, clDoc.getPageIndices()))
      merged.addPage(p);

    const cvDoc = await PDFDocument.load(cvBytes);
    for (const p of await merged.copyPages(cvDoc, cvDoc.getPageIndices()))
      merged.addPage(p);

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
