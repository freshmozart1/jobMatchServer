import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Request } from 'express';
import * as fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import {
    getCollection,
    connectionStringConfigured,
    mockLocalDatabaseModule,
} from '../testMockModules/localDatabase.test.js';
import {
    connect,
    close,
    mockMongoDbModule,
} from '../testMockModules/mongodb.test.js';
import createResponse from '../testHelpers/createResponse.test.js';

const readFile = jest.fn<typeof fs.readFile>();
jest.unstable_mockModule('fs/promises', () => ({ ...fs, readFile }));
const render = jest.fn<() => Promise<Uint8Array>>();
class OverflowError extends Error {}
jest.unstable_mockModule('#database/coverLetterPdf.js', () => ({
    coverLetterToHtml: () => '<html>synthetic</html>',
    renderCoverLetterPdf: render,
    CoverLetterOverflowError: OverflowError,
}));
mockMongoDbModule();
mockLocalDatabaseModule();
const { default: uploadCV } = await import('./uploadCV.js');
const { default: getCV } = await import('./getCV.js');
const { default: getApplication } = await import('./getApplication.js');
const { withCvRetirementLease } = await import('./cvFileAccess.js');

type CvRecord = { _id: string; jobId: string; filePath: string };
const records = new Map<string, CvRecord>();
const findJob =
    jest.fn<
        (filter: {
            duplicateKey: string;
        }) => Promise<{ _id: { toHexString: () => string } } | null>
    >();
const findCv =
    jest.fn<
        (
            filter: { jobId: string },
            options?: unknown,
        ) => Promise<CvRecord | null>
    >();
const replaceCv = jest.fn<
    (
        filter: { jobId: string },
        replacement: Omit<CvRecord, '_id'>,
    ) => Promise<{
        ok: number;
        value: CvRecord | null;
        lastErrorObject: { upserted: string };
    }>
>();
const queryOwners = jest.fn<() => Promise<CvRecord[]>>();
let paths: string[];
let coverLetterBytes: Uint8Array;

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}
async function pdfBytes(width: number): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    document.addPage([width, 300]);
    return document.save();
}
async function file(width: number): Promise<string> {
    const filePath = path.resolve('uploads/cv', `reader-${randomUUID()}`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, await pdfBytes(width));
    paths.push(filePath);
    return filePath;
}
async function seed(key = 'job'): Promise<string> {
    const filePath = await file(200);
    records.set(key, { _id: `cv-${key}`, jobId: key, filePath });
    return filePath;
}
function downloadRequest(key = 'job'): Request<{ jobDuplicateKey: string }> {
    return { params: { jobDuplicateKey: key } } as Request<{
        jobDuplicateKey: string;
    }>;
}
function uploadRequest(filePath: string, key = 'job'): Request {
    return {
        body: { jobDuplicateKey: key },
        file: { path: filePath, mimetype: 'application/pdf' },
    } as Request;
}
function downloadResponse() {
    const base = createResponse();
    const end = jest.fn<(bytes: Buffer) => void>();
    const setHeader = jest.fn();
    const sendFile = jest.fn<
        (filePath: string, callback: (error?: Error) => void) => void
    >((filePath, callback) => {
        void fs.readFile(filePath).then((bytes) => {
            end(bytes);
            callback();
        }, callback);
    });
    Object.assign(base.response, { end, setHeader, sendFile });
    return { ...base, end, setHeader, sendFile };
}
function induceDownloadFailure(
    failure: string,
    response: ReturnType<typeof downloadResponse>,
): void {
    const error = new Error(failure);
    if (failure === 'client construction')
        connectionStringConfigured.mockImplementationOnce(() => {
            throw error;
        });
    if (failure === 'missing job') findJob.mockResolvedValueOnce(null);
    if (failure === 'missing CV') findCv.mockResolvedValueOnce(null);
    if (failure === 'render') render.mockRejectedValueOnce(error);
    if (failure === 'overflow')
        render.mockRejectedValueOnce(new OverflowError('Shorten the letter'));
    if (failure === 'response')
        response.end.mockImplementationOnce(() => {
            throw error;
        });
    if (failure === 'close') close.mockRejectedValueOnce(error);
    if (failure === 'sendFile')
        response.sendFile.mockImplementationOnce((_path, callback) =>
            callback(error),
        );
}

async function checkFile(filePath: string, exists: boolean): Promise<void> {
    if (exists) await expect(fs.access(filePath)).resolves.toBeUndefined();
    else
        await expect(fs.access(filePath)).rejects.toMatchObject({
            code: 'ENOENT',
        });
}
function signalWrites() {
    const first = deferred<void>();
    const second = deferred<void>();
    replaceCv.mockImplementation(async ({ jobId }, replacement) => {
        const previous = records.get(jobId) ?? null;
        records.set(jobId, { ...replacement, _id: `cv-${jobId}` });
        if (replaceCv.mock.calls.length === 1) first.resolve();
        else second.resolve();
        return {
            ok: 1,
            value: previous,
            lastErrorObject: { upserted: `cv-${jobId}` },
        };
    });
    return { first, second };
}

beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    paths = [];
    records.clear();
    coverLetterBytes = await pdfBytes(595);
    render.mockReset().mockResolvedValue(coverLetterBytes);
    readFile.mockReset().mockImplementation(fs.readFile);
    connectionStringConfigured.mockReset().mockReturnValue(true);
    connect.mockReset().mockResolvedValue();
    close.mockReset().mockResolvedValue();
    findJob.mockReset().mockImplementation(async ({ duplicateKey }) => ({
        _id: { toHexString: () => duplicateKey },
    }));
    findCv
        .mockReset()
        .mockImplementation(async ({ jobId }) => records.get(jobId) ?? null);
    queryOwners
        .mockReset()
        .mockImplementation(async () => [...records.values()]);
    signalWrites();
    getCollection.mockReset().mockImplementation((_client, name) => {
        if (name === 'jobs') return { findOne: findJob };
        if (name === 'cv')
            return {
                findOne: findCv,
                findOneAndReplace: replaceCv,
                find: () => ({ toArray: queryOwners }),
            };
        if (name === 'certificates')
            return { find: () => ({ toArray: async () => [] }) };
        return { findOne: async () => ({}) };
    });
});
afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
        paths.map((filePath) => fs.rm(filePath, { force: true })),
    );
});

describe('active CV download ownership', () => {
    it('keeps the selected CV while application rendering waits, then retires it after a valid PDF response', async () => {
        const oldPath = await seed();
        const newPath = await file(400);
        const rendering = deferred<void>();
        const finishRender = deferred<Uint8Array>();
        render.mockImplementationOnce(() => {
            rendering.resolve();
            return finishRender.promise;
        });
        const applicationResponse = downloadResponse();
        const application = getApplication(
            downloadRequest(),
            applicationResponse.response,
        );
        await rendering.promise;
        const writes = signalWrites();
        const uploaded = uploadCV(
            uploadRequest(newPath),
            createResponse().response,
        );
        await writes.first.promise;
        await new Promise((resolve) => setImmediate(resolve));
        expect(records.get('job')?.filePath).toBe(newPath);
        expect(queryOwners).not.toHaveBeenCalled();
        await checkFile(oldPath, true);
        finishRender.resolve(coverLetterBytes);
        await application;
        const merged = await PDFDocument.load(
            applicationResponse.end.mock.calls[0]![0],
        );
        expect(merged.getPageCount()).toBe(2);
        expect(merged.getPages()[1]!.getWidth()).toBe(200);
        expect(readFile).toHaveBeenCalledWith(oldPath);
        await uploaded;
        await checkFile(oldPath, false);
        await checkFile(newPath, true);
    });

    it('leases before CV lookup and protects the later sendFile open window', async () => {
        const oldPath = await seed();
        const oldRecord = records.get('job')!;
        const newPath = await file(400);
        const lookupStarted = deferred<void>();
        const lookup = deferred<CvRecord>();
        findCv.mockImplementationOnce(() => {
            lookupStarted.resolve();
            return lookup.promise;
        });
        const reachedSendFile = deferred<void>();
        const openFile = deferred<void>();
        const response = downloadResponse();
        response.sendFile.mockImplementation((filePath, callback) => {
            reachedSendFile.resolve();
            void openFile.promise
                .then(() => fs.readFile(filePath))
                .then((bytes) => {
                    response.end(bytes);
                    callback();
                }, callback);
        });
        const downloading = getCV(downloadRequest(), response.response);
        await lookupStarted.promise;
        const writes = signalWrites();
        const uploaded = uploadCV(
            uploadRequest(newPath),
            createResponse().response,
        );
        await writes.first.promise;
        await checkFile(oldPath, true);
        lookup.resolve(oldRecord);
        await reachedSendFile.promise;
        await checkFile(oldPath, true);
        openFile.resolve();
        await downloading;
        const downloaded = await PDFDocument.load(
            response.end.mock.calls[0]![0],
        );
        expect(downloaded.getPages()[0]!.getWidth()).toBe(200);
        await uploaded;
        await checkFile(oldPath, false);
        await checkFile(newPath, true);
    });

    it('waits for all concurrent readers across overlapping replacements', async () => {
        const oldPath = await seed();
        const firstPath = await file(400);
        const secondPath = await file(500);
        const responses = [downloadResponse(), downloadResponse()];
        const opens = [deferred<void>(), deferred<void>()];
        const started = [deferred<void>(), deferred<void>()];
        for (let index = 0; index < responses.length; index++)
            responses[index]!.sendFile.mockImplementation(
                (filePath, callback) => {
                    started[index]!.resolve();
                    void opens[index]!.promise.then(() =>
                        fs.readFile(filePath),
                    ).then((bytes) => {
                        responses[index]!.end(bytes);
                        callback();
                    }, callback);
                },
            );
        const downloads = responses.map((response) =>
            getCV(downloadRequest(), response.response),
        );
        await Promise.all(started.map((event) => event.promise));
        const writes = signalWrites();
        const firstUpload = uploadCV(
            uploadRequest(firstPath),
            createResponse().response,
        );
        await writes.first.promise;
        const secondUpload = uploadCV(
            uploadRequest(secondPath),
            createResponse().response,
        );
        await writes.second.promise;
        opens[0]!.resolve();
        await downloads[0];
        await checkFile(oldPath, true);
        expect(queryOwners).not.toHaveBeenCalled();
        opens[1]!.resolve();
        await Promise.all([...downloads, firstUpload, secondUpload]);
        for (const response of responses)
            expect(
                (await PDFDocument.load(response.end.mock.calls[0]![0]))
                    .getPages()[0]!
                    .getWidth(),
            ).toBe(200);
        await checkFile(oldPath, false);
        await checkFile(firstPath, false);
        await checkFile(secondPath, true);
    });

    it('queues new readers before lookup while retirement rechecks ownership', async () => {
        const oldPath = await seed();
        const newPath = await file(400);
        const checking = deferred<void>();
        const finishCheck = deferred<CvRecord[]>();
        queryOwners.mockImplementationOnce(() => {
            checking.resolve();
            return finishCheck.promise;
        });
        const uploaded = uploadCV(
            uploadRequest(newPath),
            createResponse().response,
        );
        await checking.promise;
        const response = downloadResponse();
        const downloading = getCV(downloadRequest(), response.response);
        await new Promise((resolve) => setImmediate(resolve));
        expect(findCv).not.toHaveBeenCalled();
        finishCheck.resolve([...records.values()]);
        await Promise.all([uploaded, downloading]);
        expect(findCv).toHaveBeenCalledWith(
            { jobId: 'job' },
            { readPreference: 'primary', readConcern: { level: 'local' } },
        );
        expect(
            (await PDFDocument.load(response.end.mock.calls[0]![0]))
                .getPages()[0]!
                .getWidth(),
        ).toBe(400);
        await checkFile(oldPath, false);
    });

    it('lets another job finish while the first job has an active reader', async () => {
        const oldFirst = await seed('first');
        const oldSecond = await seed('second');
        const newFirst = await file(400);
        const newSecond = await file(500);
        const rendering = deferred<void>();
        const finishRender = deferred<Uint8Array>();
        render.mockImplementationOnce(() => {
            rendering.resolve();
            return finishRender.promise;
        });
        const application = getApplication(
            downloadRequest('first'),
            downloadResponse().response,
        );
        await rendering.promise;
        const writes = signalWrites();
        const firstUpload = uploadCV(
            uploadRequest(newFirst, 'first'),
            createResponse().response,
        );
        await writes.first.promise;
        await getCV(downloadRequest('second'), downloadResponse().response);
        await uploadCV(
            uploadRequest(newSecond, 'second'),
            createResponse().response,
        );
        await checkFile(oldSecond, false);
        await checkFile(oldFirst, true);
        finishRender.resolve(coverLetterBytes);
        await Promise.all([application, firstUpload]);
        await checkFile(oldFirst, false);
    });

    it.each([
        'client construction',
        'missing job',
        'missing CV',
        'render',
        'overflow',
        'response',
        'close',
        'sendFile',
    ])('releases reader leases after %s failure', async (failure) => {
        const oldPath = await seed();
        const newPath = await file(400);
        const response = downloadResponse();
        induceDownloadFailure(failure, response);
        const handler = ['render', 'overflow', 'response'].includes(failure)
            ? getApplication
            : getCV;
        const download = handler(downloadRequest(), response.response);
        if (['client construction', 'close'].includes(failure))
            await expect(download).rejects.toThrow(failure);
        else await download;
        if (failure === 'overflow') {
            expect(response.status).toHaveBeenCalledWith(422);
            expect(readFile).not.toHaveBeenCalled();
        }
        await uploadCV(uploadRequest(newPath), createResponse().response);
        await checkFile(oldPath, false);
        await checkFile(newPath, true);
    });

    it('releases a rejected retirement operation and admits queued readers', async () => {
        await seed();
        const retiring = deferred<void>();
        const finish = deferred<void>();
        const retirement = withCvRetirementLease('job', async () => {
            retiring.resolve();
            await finish.promise;
            throw new Error('retirement failed');
        });
        const rejection =
            expect(retirement).rejects.toThrow('retirement failed');
        await retiring.promise;
        const response = downloadResponse();
        const downloading = getCV(downloadRequest(), response.response);
        await new Promise((resolve) => setImmediate(resolve));
        expect(findCv).not.toHaveBeenCalled();
        finish.resolve();
        await rejection;
        await downloading;
        expect(response.end).toHaveBeenCalledTimes(1);
    });
});
