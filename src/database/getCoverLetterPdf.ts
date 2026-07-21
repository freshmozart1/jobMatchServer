import type { Request, Response } from 'express';
import { MongoClient } from 'mongodb';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import type { StoredCoverLetter, StoredUser } from '#types';
import { coverLetterToHtml, renderCoverLetterPdf } from './coverLetterPdf.js';
import {
  connectionStringConfigured,
  findJobByDuplicateKey,
  getCollection,
  jobNotFoundError,
  MONGODB_CONNECTION,
  USER_ID,
} from './database.js';

const coverLetterNotFoundError = new Error('Cover letter not found');

export default async function getCoverLetterPdf(
  request: Request<{ jobDuplicateKey: string }>,
  response: Response,
): Promise<void> {
  if (!connectionStringConfigured(response)) return;

  const { jobDuplicateKey } = request.params;

  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    await client.connect();

    const coverLetter = await getCollection<StoredCoverLetter>(
      client,
      'coverLetters',
    ).findOne({ jobDuplicateKey });
    if (!coverLetter) throw coverLetterNotFoundError;

    const job = await findJobByDuplicateKey(client, jobDuplicateKey);

    const user = await getCollection<StoredUser>(client, 'users').findOne({
      _id: USER_ID,
    });
    if (!user) throw new Error('User not found');

    const html = coverLetterToHtml(coverLetter, job, user);
    const pdfBytes = await renderCoverLetterPdf(html);

    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="cover-letter.pdf"',
    );
    response.end(Buffer.from(pdfBytes));
  } catch (error) {
    createErrorMessage(
      response,
      error,
      'Error retrieving cover letter',
      error === coverLetterNotFoundError || error === jobNotFoundError
        ? 404
        : 500,
    );
  } finally {
    await client.close();
  }
}
