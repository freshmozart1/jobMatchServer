import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Request } from 'express';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
    mockLocalDatabaseModule,
    getCollection,
} from '../testMockModules/localDatabase.test.js';
import {
    mockMongoDbModule,
    connect,
    close,
} from '../testMockModules/mongodb.test.js';
import createResponse from '../testHelpers/createResponse.test.js';

mockMongoDbModule();
mockLocalDatabaseModule();

const { default: uploadCertificates } = await import('./uploadCertificates.js');

const job = { _id: { toHexString: () => 'job-object-id' } };
const findOne = jest.fn<(filter: unknown) => Promise<typeof job>>();
const insertMany =
    jest.fn<
        (docs: unknown[]) => Promise<{ insertedIds: Record<number, string> }>
    >();

function createRequest(body: unknown, files?: Express.Multer.File[]): Request {
    return { body, files } as Request;
}

function multerFile(
    filePath: string,
    mimetype: string,
    originalname = 'certificate.pdf',
): Express.Multer.File {
    return {
        fieldname: 'files',
        originalname,
        encoding: '7bit',
        mimetype,
        size: 0,
        destination: path.dirname(filePath),
        filename: path.basename(filePath),
        path: filePath,
        buffer: Buffer.alloc(0),
    } as unknown as Express.Multer.File;
}

describe('uploadCertificates', () => {
    let tmpDir: string;

    beforeEach(async () => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        tmpDir = await mkdtemp(path.join(tmpdir(), 'upload-certs-test-'));
        connect.mockResolvedValue();
        close.mockResolvedValue();
        findOne.mockResolvedValue(job);
        insertMany.mockResolvedValue({ insertedIds: { 0: 'cert-id-0' } });
        getCollection.mockImplementation((_client: unknown, name: unknown) =>
            name === 'jobs' ? { findOne } : { insertMany },
        );
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('returns 400 when jobDuplicateKey is not a string', async () => {
        const request = createRequest({});
        const { response, status } = createResponse();

        await uploadCertificates(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('returns 400 when no files are provided', async () => {
        const request = createRequest({ jobDuplicateKey: 'job-key' }, []);
        const { response, status } = createResponse();

        await uploadCertificates(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(insertMany).not.toHaveBeenCalled();
    });

    it('rejects the whole batch and deletes every file when one file is not a valid type', async () => {
        const validPath = path.join(tmpDir, 'valid.pdf');
        const invalidPath = path.join(tmpDir, 'invalid.png');
        await writeFile(validPath, '%PDF-1.7\n%%EOF');
        await writeFile(invalidPath, 'not actually a png');
        const request = createRequest({ jobDuplicateKey: 'job-key' }, [
            multerFile(validPath, 'application/pdf'),
            multerFile(invalidPath, 'image/png', 'invalid.png'),
        ]);
        const { response, status, json } = createResponse();

        await uploadCertificates(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'File "invalid.png" is not a valid PDF, JPEG, or PNG file',
            }),
        );
        expect(insertMany).not.toHaveBeenCalled();
        await expect(access(validPath)).rejects.toThrow();
        await expect(access(invalidPath)).rejects.toThrow();
    });

    it('stores every certificate when all files have valid content', async () => {
        const pdfPath = path.join(tmpDir, 'cert.pdf');
        const pngPath = path.join(tmpDir, 'cert.png');
        await writeFile(pdfPath, '%PDF-1.7\n%%EOF');
        await writeFile(
            pngPath,
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
        const request = createRequest({ jobDuplicateKey: 'job-key' }, [
            multerFile(pdfPath, 'application/pdf', 'cert.pdf'),
            multerFile(pngPath, 'image/png', 'cert.png'),
        ]);
        const { response, status, json } = createResponse();

        await uploadCertificates(request, response);

        expect(insertMany).toHaveBeenCalledWith([
            {
                jobId: 'job-object-id',
                filePath: pdfPath,
                originalName: 'cert.pdf',
                mimeType: 'application/pdf',
            },
            {
                jobId: 'job-object-id',
                filePath: pngPath,
                originalName: 'cert.png',
                mimeType: 'image/png',
            },
        ]);
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({
            message: 'Certificates uploaded',
            certificateIds: ['cert-id-0'],
        });
        await expect(access(pdfPath)).resolves.toBeUndefined();
        await expect(access(pngPath)).resolves.toBeUndefined();
    });
});
