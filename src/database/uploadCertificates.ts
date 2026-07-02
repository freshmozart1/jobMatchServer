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

const ALLOWED_MIMETYPES = /^(application\/pdf|image\/(jpeg|jpg|png))$/;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

function isAllowedFile(file: Express.Multer.File): boolean {
  if (ALLOWED_MIMETYPES.test(file.mimetype)) return true;
  const ext = file.originalname
    .slice(file.originalname.lastIndexOf('.'))
    .toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

export default async function uploadCertificates(
  request: Request,
  response: Response,
): Promise<void> {
  const jobDuplicateKey = request.body['jobDuplicateKey'] as unknown;
  const jobDuplicateKeyMustBeStringError = new Error(
    'jobDuplicateKey must be a string',
  );

  if (!connectionStringConfigured(response)) return;

  if (typeof jobDuplicateKey !== 'string') {
    createErrorMessage(
      response,
      jobDuplicateKeyMustBeStringError,
      'Error uploading certificates',
      400,
    );
    return;
  }

  const files = request.files;
  if (!Array.isArray(files) || files.length === 0) {
    createErrorMessage(
      response,
      new Error('At least one file is required'),
      'Error uploading certificates',
      400,
    );
    return;
  }

  const invalidFile = files.find((f) => !isAllowedFile(f));
  if (invalidFile) {
    createErrorMessage(
      response,
      new Error(`File "${invalidFile.originalname}" is not a PDF or image`),
      'Error uploading certificates',
      400,
    );
    return;
  }

  const client = new MongoClient(MONGODB_CONNECTION!);
  try {
    await client.connect();
    const job = await findJobByDuplicateKey(client, jobDuplicateKey);

    const docs: StoredCertificate[] = files.map((f) => ({
      jobId: job._id.toHexString(),
      filePath: f.path,
      originalName: f.originalname,
      mimeType: f.mimetype,
    }));
    const result = await getCollection<StoredCertificate>(
      client,
      'certificates',
    ).insertMany(docs);
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
    await client.close();
  }
}
