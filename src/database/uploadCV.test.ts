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

const { default: uploadCV } = await import('./uploadCV.js');

const job = { _id: { toHexString: () => 'job-object-id' } };
const findOne = jest.fn<(filter: unknown) => Promise<typeof job>>();
const findOneAndReplace =
    jest.fn<(...args: unknown[]) => Promise<{ _id: string } | null>>();

function createRequest(body: unknown, file?: Express.Multer.File): Request {
    return { body, file } as Request;
}

function multerFile(filePath: string, mimetype: string): Express.Multer.File {
    return {
        fieldname: 'file',
        originalname: 'cv.pdf',
        encoding: '7bit',
        mimetype,
        size: 0,
        destination: path.dirname(filePath),
        filename: path.basename(filePath),
        path: filePath,
        buffer: Buffer.alloc(0),
    } as unknown as Express.Multer.File;
}

describe('uploadCV', () => {
    let tmpDir: string;

    beforeEach(async () => {
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        tmpDir = await mkdtemp(path.join(tmpdir(), 'upload-cv-test-'));
        connect.mockResolvedValue();
        close.mockResolvedValue();
        findOne.mockResolvedValue(job);
        findOneAndReplace.mockResolvedValue({ _id: 'cv-id' });
        getCollection.mockImplementation((_client: unknown, name: unknown) =>
            name === 'jobs' ? { findOne } : { findOneAndReplace },
        );
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await rm(tmpDir, { recursive: true, force: true });
    });

    it('returns 400 when jobDuplicateKey is not a string', async () => {
        const request = createRequest({});
        const { response, status } = createResponse();

        await uploadCV(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(findOneAndReplace).not.toHaveBeenCalled();
    });

    it('returns 400 when no file is provided', async () => {
        const request = createRequest({ jobDuplicateKey: 'job-key' });
        const { response, status } = createResponse();

        await uploadCV(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(findOneAndReplace).not.toHaveBeenCalled();
    });

    it('rejects and deletes the file when its content is not a real PDF', async () => {
        const filePath = path.join(tmpDir, 'fake.pdf');
        await writeFile(filePath, 'not actually a pdf');
        const request = createRequest(
            { jobDuplicateKey: 'job-key' },
            multerFile(filePath, 'application/pdf'),
        );
        const { response, status, json } = createResponse();

        await uploadCV(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({ error: 'file must be a PDF' }),
        );
        expect(findOneAndReplace).not.toHaveBeenCalled();
        await expect(access(filePath)).rejects.toThrow();
    });

    it('stores the CV when the file content is a real PDF', async () => {
        const filePath = path.join(tmpDir, 'real.pdf');
        await writeFile(filePath, '%PDF-1.7\n%%EOF');
        const request = createRequest(
            { jobDuplicateKey: 'job-key' },
            multerFile(filePath, 'application/pdf'),
        );
        const { response, status, json } = createResponse();

        await uploadCV(request, response);

        expect(findOneAndReplace).toHaveBeenCalledWith(
            { jobId: 'job-object-id' },
            { jobId: 'job-object-id', filePath },
            { upsert: true, returnDocument: 'after' },
        );
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({
            message: 'CV uploaded',
            cvId: 'cv-id',
        });
        await expect(access(filePath)).resolves.toBeUndefined();
    });
});
