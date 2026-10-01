import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Request, Response } from 'express';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import {
    MongoBulkWriteError,
    MongoServerError,
    MongoWriteConcernError,
    type BulkWriteResult,
} from 'mongodb';
import {
    mockLocalDatabaseModule,
    getCollection,
    connectionStringConfigured,
} from '../testMockModules/localDatabase.test.js';
import {
    mockMongoDbModule,
    connect,
    close,
} from '../testMockModules/mongodb.test.js';
import createResponse from '../testHelpers/createResponse.test.js';

// Keep real files and signature verification; inject only the failing filesystem
// operation so permission tests work on both root and unprivileged CI runners.
const unlink = jest.fn<typeof fs.unlink>();
const open = jest.fn<typeof fs.open>();
jest.unstable_mockModule('fs/promises', () => ({ ...fs, unlink, open }));
mockMongoDbModule();
mockLocalDatabaseModule();
const { MongoClient } = await import('mongodb');
const { default: uploadCV } = await import('./uploadCV.js');
const { default: uploadCertificates } = await import('./uploadCertificates.js');

const job = { _id: { toHexString: () => 'job-id' } };
const findJob = jest.fn<() => Promise<typeof job | null>>();
type CvRecord = { _id: string; jobId: string; filePath: string };
type CvResult = {
    ok: number;
    value: CvRecord | null;
    lastErrorObject?: { upserted: string };
};
const replace =
    jest.fn<
        (
            filter: unknown,
            replacement: { jobId: string; filePath: string },
            options: unknown,
        ) => Promise<CvResult>
    >();
const insert = jest.fn<
    (...args: unknown[]) => Promise<{
        acknowledged: boolean;
        insertedIds: Record<number, string>;
    }>
>();
const owned = jest.fn<() => Promise<{ filePath: string }[]>>();
const find = jest.fn<(...args: unknown[]) => { toArray: typeof owned }>();
const cvCollection = { findOneAndReplace: replace, find };
const certificateCollection = { insertMany: insert, find };
const routes = [
    {
        name: 'CV',
        handler: uploadCV,
        collection: 'cv',
        write: replace,
        fileCount: 1,
    },
    {
        name: 'certificates',
        handler: uploadCertificates,
        collection: 'certificates',
        write: insert,
        fileCount: 2,
    },
];
function requestFor(
    name: string,
    filePaths: string[],
    body: unknown = { jobDuplicateKey: 'job-key' },
): Request {
    const files = filePaths.map((filePath) => ({
        path: filePath,
        mimetype: 'application/pdf',
        originalname: path.basename(filePath),
    }));
    return {
        body,
        ...(name === 'CV' ? { file: files[0] } : { files }),
    } as Request;
}
function bulkRejection(writeConcern = false): MongoBulkWriteError {
    // Model the installed driver's acknowledged ordered write-error shape. The
    // misleading generated IDs deliberately include the rejected/unattempted file.
    return new MongoBulkWriteError(
        {
            message: 'duplicate',
            code: 11000,
            writeErrors: [{ index: 1, code: 11000 }],
        } as ConstructorParameters<typeof MongoBulkWriteError>[0],
        {
            insertedIds: { 0: 'generated-0', 1: 'generated-1' },
            getWriteConcernError: () =>
                writeConcern ? { code: 64 } : undefined,
        } as unknown as BulkWriteResult,
    );
}

let temporaryDirectory: string;
let managedPaths: string[];
async function pdf(managed = false): Promise<string> {
    const filePath = path.join(
        managed ? path.resolve('uploads/cv') : temporaryDirectory,
        `ownership-${randomUUID()}`,
    );
    if (managed) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        managedPaths.push(filePath);
    }
    await fs.writeFile(filePath, '%PDF-1.7\n%%EOF');
    return filePath;
}
async function expectFiles(
    filePaths: string[],
    present: boolean,
): Promise<void> {
    for (const filePath of filePaths) {
        if (present) await expect(fs.access(filePath)).resolves.toBeUndefined();
        else
            await expect(fs.access(filePath)).rejects.toMatchObject({
                code: 'ENOENT',
            });
    }
}

beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    temporaryDirectory = await fs.mkdtemp(
        path.join(tmpdir(), 'upload-ownership-'),
    );
    managedPaths = [];
    unlink.mockReset().mockImplementation(fs.unlink);
    open.mockReset().mockImplementation(fs.open);
    connect.mockReset().mockResolvedValue();
    close.mockReset().mockResolvedValue();
    findJob.mockReset().mockResolvedValue(job);
    replace.mockReset().mockResolvedValue({
        ok: 1,
        value: null,
        lastErrorObject: { upserted: 'cv-id' },
    });
    insert.mockReset().mockResolvedValue({
        acknowledged: true,
        insertedIds: { 0: 'certificate-0', 1: 'certificate-1' },
    });
    owned.mockReset().mockResolvedValue([]);
    find.mockReset().mockReturnValue({ toArray: owned });
    connectionStringConfigured.mockReset().mockReturnValue(true);
    getCollection
        .mockReset()
        .mockImplementation((_client, name) =>
            name === 'jobs'
                ? { findOne: findJob }
                : name === 'cv'
                  ? cvCollection
                  : certificateCollection,
        );
});
afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    await Promise.all(
        managedPaths.map((filePath) =>
            fs.rm(filePath, { recursive: true, force: true }),
        ),
    );
});

describe.each(routes)(
    '$name staged upload ownership',
    ({ name, handler, collection, write, fileCount }) => {
        it.each([
            ['absent key', {}, 400],
            ['absent body', undefined, 400],
            ['null body', null, 400],
            ['wrong key type', { jobDuplicateKey: [] }, 400],
        ])(
            'deletes staged files after %s',
            async (_label, body, statusCode) => {
                const paths = await Promise.all(
                    Array.from({ length: fileCount }, () => pdf()),
                );
                const request = requestFor(name, paths);
                request.body = body;
                const { response, status } = createResponse();
                await handler(request, response);
                expect(status).toHaveBeenCalledWith(statusCode);
                expect(write).not.toHaveBeenCalled();
                await expectFiles(paths, false);
            },
        );

        it('deletes staged files when the connection string is absent', async () => {
            connectionStringConfigured.mockImplementation((response) => {
                (response as Response)
                    .status(500)
                    .json({ message: 'Connection string not configured' });
                return false;
            });
            const paths = await Promise.all(
                Array.from({ length: fileCount }, () => pdf()),
            );
            const { response, status } = createResponse();
            await handler(requestFor(name, paths), response);
            expect(status).toHaveBeenCalledWith(500);
            expect(connect).not.toHaveBeenCalled();
            await expectFiles(paths, false);
        });

        it.each([
            'content read',
            'client construction',
            'connect',
            'missing job',
            'job read',
            'job id decoding',
            'collection setup',
        ])('deletes files on a prewrite %s failure', async (failure) => {
            const paths = await Promise.all(
                Array.from({ length: fileCount }, () => pdf()),
            );
            const error = new Error(failure);
            if (failure === 'content read') open.mockRejectedValueOnce(error);
            if (failure === 'client construction')
                jest.mocked(MongoClient).mockImplementationOnce(() => {
                    throw error;
                });
            if (failure === 'connect') connect.mockRejectedValueOnce(error);
            if (failure === 'missing job') findJob.mockResolvedValueOnce(null);
            if (failure === 'job read') findJob.mockRejectedValueOnce(error);
            if (failure === 'job id decoding')
                findJob.mockResolvedValueOnce({
                    _id: {
                        toHexString: () => {
                            throw error;
                        },
                    },
                });
            if (failure === 'collection setup')
                getCollection.mockImplementation(
                    (_client, requestedCollection) => {
                        if (requestedCollection === collection) throw error;
                        return { findOne: findJob };
                    },
                );
            const { response, status } = createResponse();
            await handler(requestFor(name, paths), response);
            expect(status).toHaveBeenCalledWith(
                failure === 'missing job' ? 404 : 500,
            );
            expect(write).not.toHaveBeenCalled();
            await expectFiles(paths, false);
        });

        it('cleans prewrite files even when client close rejects', async () => {
            const paths = await Promise.all(
                Array.from({ length: fileCount }, () => pdf()),
            );
            connect.mockRejectedValueOnce(new Error('connect failed'));
            close.mockRejectedValueOnce(new Error('close failed'));
            await expect(
                handler(requestFor(name, paths), createResponse().response),
            ).rejects.toThrow('close failed');
            await expectFiles(paths, false);
        });

        it.each(['response', 'close'])(
            'retains acknowledged files when %s fails',
            async (failure) => {
                const paths = await Promise.all(
                    Array.from({ length: fileCount }, () => pdf()),
                );
                const { response, json } = createResponse();
                if (failure === 'response')
                    json.mockImplementation(() => {
                        throw new Error('response failed');
                    });
                else close.mockRejectedValueOnce(new Error('close failed'));
                await expect(
                    handler(requestFor(name, paths), response),
                ).rejects.toThrow(`${failure} failed`);
                expect(write).toHaveBeenCalledTimes(1);
                expect(find).not.toHaveBeenCalled();
                await expectFiles(paths, true);
            },
        );

        it.each([11000, 121])(
            'reconciles acknowledged server rejection %s and removes absent files',
            async (code) => {
                const paths = await Promise.all(
                    Array.from({ length: fileCount }, () => pdf()),
                );
                write.mockRejectedValueOnce(
                    new MongoServerError({ message: 'rejected', code }),
                );
                const { response, status } = createResponse();
                await handler(requestFor(name, paths), response);
                expect(status).toHaveBeenCalledWith(500);
                expect(find).toHaveBeenCalledWith(
                    { filePath: { $in: paths } },
                    {
                        projection: { filePath: 1 },
                        readPreference: 'primary',
                        readConcern: { level: 'local' },
                    },
                );
                await expectFiles(paths, false);
            },
        );

        it('retains referenced files after a definitive rejection', async () => {
            const paths = await Promise.all(
                Array.from({ length: fileCount }, () => pdf()),
            );
            write.mockRejectedValueOnce(
                new MongoServerError({ message: 'rejected', code: 121 }),
            );
            owned.mockResolvedValue(paths.map((filePath) => ({ filePath })));
            await handler(requestFor(name, paths), createResponse().response);
            await expectFiles(paths, true);
        });

        it('retains every staged file when reconciliation fails', async () => {
            const paths = await Promise.all(
                Array.from({ length: fileCount }, () => pdf()),
            );
            write.mockRejectedValueOnce(
                new MongoServerError({ message: 'rejected', code: 121 }),
            );
            owned.mockRejectedValueOnce(new Error('primary unavailable'));
            await handler(requestFor(name, paths), createResponse().response);
            await expectFiles(paths, true);
            expect(console.error).toHaveBeenCalledWith(
                'Upload ownership could not be checked; retaining uploaded files',
                expect.any(Error),
            );
        });

        it.each([
            'network',
            'timeout',
            'write concern',
            'unknown server error',
        ])(
            'preserves uncertain %s outcomes without treating an empty read as proof',
            async (failure) => {
                const paths = await Promise.all(
                    Array.from({ length: fileCount }, () => pdf()),
                );
                const error =
                    failure === 'write concern'
                        ? new MongoWriteConcernError({
                              ok: 1,
                              writeConcernError: {
                                  code: 64,
                                  errmsg: 'uncertain',
                              },
                          })
                        : failure === 'unknown server error'
                          ? new MongoServerError({
                                message: 'uncertain',
                                code: 50,
                            })
                          : new Error(failure);
                Object.assign(error, {
                    insertedIds: { 0: 'generated-not-proof' },
                });
                write.mockRejectedValueOnce(error);
                const { response, status } = createResponse();
                await handler(requestFor(name, paths), response);
                expect(status).toHaveBeenCalledWith(500);
                expect(find).not.toHaveBeenCalled();
                await expectFiles(paths, true);
                // The server may finish a timed-out write after the handler has answered.
                owned.mockResolvedValue(
                    paths.map((filePath) => ({ filePath })),
                );
                await expectFiles(paths, true);
            },
        );

        it('logs unlink failures and continues cleaning the remaining batch', async () => {
            const paths = await Promise.all(
                Array.from({ length: fileCount }, () => pdf()),
            );
            unlink.mockImplementation(async (filePath) => {
                if (filePath === paths[0])
                    throw Object.assign(new Error('permission denied'), {
                        code: 'EACCES',
                    });
                await fs.unlink(filePath);
            });
            const { response, status } = createResponse();
            await handler(requestFor(name, paths, {}), response);
            expect(status).toHaveBeenCalledWith(400);
            await expectFiles(paths.slice(0, 1), true);
            await expectFiles(paths.slice(1), false);
            expect(console.error).toHaveBeenCalledWith(
                'Could not remove an unused upload file',
                expect.any(Error),
            );
        });
    },
);

describe('CV replacement ownership', () => {
    it('atomically returns the current cvId and removes a superseded managed file', async () => {
        const oldPath = await pdf(true);
        const newPath = await pdf(true);
        replace.mockResolvedValue({
            ok: 1,
            value: {
                _id: 'existing-cv-id',
                jobId: 'job-id',
                filePath: path.relative(process.cwd(), oldPath),
            },
        });
        owned.mockResolvedValue([{ filePath: newPath }]);
        const { response, status, json } = createResponse();
        await uploadCV(requestFor('CV', [newPath]), response);
        expect(replace).toHaveBeenCalledWith(
            { jobId: 'job-id' },
            { jobId: 'job-id', filePath: newPath },
            {
                upsert: true,
                returnDocument: 'before',
                includeResultMetadata: true,
            },
        );
        expect(json).toHaveBeenCalledWith({
            message: 'CV uploaded',
            cvId: 'existing-cv-id',
        });
        expect(status).toHaveBeenCalledWith(201);
        expect(find).toHaveBeenCalledWith(
            {},
            {
                projection: { filePath: 1 },
                readPreference: 'primary',
                readConcern: { level: 'local' },
            },
        );
        await expectFiles([oldPath], false);
        await expectFiles([newPath], true);
    });

    it('returns the inserted cvId on the first upload', async () => {
        const newPath = await pdf();
        const { response, json } = createResponse();
        await uploadCV(requestFor('CV', [newPath]), response);
        expect(json).toHaveBeenCalledWith({
            message: 'CV uploaded',
            cvId: 'cv-id',
        });
        expect(find).not.toHaveBeenCalled();
        await expectFiles([newPath], true);
    });

    it.each([
        'shared alias',
        'same path',
        'malformed stored path',
        'outside upload directory',
        'nested path',
        'ownership read failure',
        'unlink failure',
    ])(
        'preserves old data on %s without failing the acknowledged upload',
        async (scenario) => {
            const newPath = await pdf(true);
            let oldPath =
                scenario === 'same path'
                    ? newPath
                    : await pdf(scenario !== 'outside upload directory');
            if (scenario === 'nested path') {
                const nested = path.join(
                    path.dirname(oldPath),
                    `directory-${randomUUID()}`,
                );
                await fs.mkdir(nested);
                managedPaths.push(nested);
                oldPath = path.join(nested, 'old.pdf');
                await fs.writeFile(oldPath, '%PDF-1.7');
            }
            replace.mockResolvedValue({
                ok: 1,
                value: {
                    _id: 'cv-id',
                    jobId: 'job-id',
                    filePath:
                        scenario === 'malformed stored path'
                            ? (42 as unknown as string)
                            : oldPath,
                },
            });
            if (scenario === 'shared alias')
                owned.mockResolvedValue([
                    { filePath: path.relative(process.cwd(), oldPath) },
                ]);
            if (scenario === 'ownership read failure')
                owned.mockRejectedValueOnce(new Error('read failed'));
            if (scenario === 'unlink failure')
                unlink.mockRejectedValueOnce(
                    Object.assign(new Error('unlink failed'), {
                        code: 'EACCES',
                    }),
                );
            const { response, status } = createResponse();
            await uploadCV(requestFor('CV', [newPath]), response);
            expect(status.mock.calls).toEqual([[201]]);
            await expectFiles([oldPath, newPath], true);
        },
    );

    it('uses atomic previous records when replacements overlap', async () => {
        const original = await pdf(true);
        const first = await pdf(true);
        const second = await pdf(true);
        let current: CvRecord = {
            _id: 'cv-id',
            jobId: 'job-id',
            filePath: original,
        };
        let releaseFirst!: (result: CvResult) => void;
        let firstWritten!: () => void;
        const firstWrite = new Promise<void>((resolve) => {
            firstWritten = resolve;
        });
        replace.mockImplementation(async (_filter, replacement) => {
            const previous = current;
            current = { ...replacement, _id: 'cv-id' };
            if (replacement.filePath === first) {
                firstWritten();
                return await new Promise<CvResult>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            return { ok: 1, value: previous };
        });
        owned.mockImplementation(async () => [current]);
        const firstResponse = createResponse();
        const firstUpload = uploadCV(
            requestFor('CV', [first]),
            firstResponse.response,
        );
        await firstWrite;
        const secondResponse = createResponse();
        await uploadCV(requestFor('CV', [second]), secondResponse.response);
        releaseFirst({
            ok: 1,
            value: { _id: 'cv-id', jobId: 'job-id', filePath: original },
        });
        await firstUpload;
        expect(current.filePath).toBe(second);
        expect(firstResponse.json).toHaveBeenCalledWith({
            message: 'CV uploaded',
            cvId: 'cv-id',
        });
        expect(secondResponse.json).toHaveBeenCalledWith({
            message: 'CV uploaded',
            cvId: 'cv-id',
        });
        await expectFiles([original, first], false);
        await expectFiles([second], true);
    });
});

describe('certificate partial and uncertain writes', () => {
    it('queries actual ownership after an ordered partial failure rather than trusting generated IDs', async () => {
        const paths = await Promise.all([pdf(), pdf(), pdf()]);
        insert.mockRejectedValueOnce(bulkRejection());
        owned.mockResolvedValue([{ filePath: paths[0]! }]);
        const { response, status } = createResponse();
        await uploadCertificates(requestFor('certificates', paths), response);
        expect(status).toHaveBeenCalledWith(500);
        expect(insert).toHaveBeenCalledWith(expect.any(Array), {
            ordered: true,
        });
        await expectFiles(paths.slice(0, 1), true);
        await expectFiles(paths.slice(1), false);
    });

    it.each(['write concern', 'network', 'reconciliation'])(
        'retains the whole batch on %s uncertainty',
        async (scenario) => {
            const paths = await Promise.all([pdf(), pdf()]);
            const error =
                scenario === 'network'
                    ? new MongoBulkWriteError(new Error('network failed'), {
                          insertedIds: { 0: 'generated-0', 1: 'generated-1' },
                          getWriteConcernError: () => undefined,
                      } as unknown as BulkWriteResult)
                    : bulkRejection(scenario === 'write concern');
            insert.mockRejectedValueOnce(error);
            if (scenario === 'reconciliation')
                owned.mockRejectedValueOnce(new Error('read failed'));
            await uploadCertificates(
                requestFor('certificates', paths),
                createResponse().response,
            );
            if (scenario !== 'reconciliation')
                expect(find).not.toHaveBeenCalled();
            await expectFiles(paths, true);
        },
    );

    it('waits for every content reader before deleting files after one reader fails', async () => {
        const paths = await Promise.all([pdf(), pdf()]);
        let releaseReader!: () => void;
        let readerStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            readerStarted = resolve;
        });
        const paused = new Promise<void>((resolve) => {
            releaseReader = resolve;
        });
        open.mockRejectedValueOnce(new Error('first read failed'));
        open.mockImplementationOnce(async (...args) => {
            readerStarted();
            await paused;
            return fs.open(...args);
        });
        const upload = uploadCertificates(
            requestFor('certificates', paths),
            createResponse().response,
        );
        await started;
        await new Promise((resolve) => setImmediate(resolve));
        expect(unlink).not.toHaveBeenCalled();
        releaseReader();
        await upload;
        await expectFiles(paths, false);
    });
});
