import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type {
    ScrapeOutcome,
    ScrapeProgressEvent,
    SuccessfulJobResult,
} from 'linkedin-job-scraper';
import {
    mockLocalDatabaseModule,
    connectionStringConfigured,
    getCollection,
} from '../../testMockModules/localDatabase.test.js';
import {
    mockMongoDbModule,
    connect,
    close,
} from '../../testMockModules/mongodb.test.js';

type MockRunScrapeOptions = {
    onProgress?: (event: ScrapeProgressEvent) => void;
    signal?: AbortSignal;
};

const mockRunScrape =
    jest.fn<(options: MockRunScrapeOptions) => Promise<unknown>>();
const mockCreateJobEmbedding = jest.fn<() => Promise<number[]>>();
const mockComputeJobMatch =
    jest.fn<(...args: unknown[]) => Promise<number | undefined>>();
const findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>();

class ScrapeAbortedError extends Error {
    override readonly name = 'AbortError';
    readonly partial: ScrapeOutcome;
    constructor(partial: ScrapeOutcome) {
        super('Scrape aborted');
        this.partial = partial;
    }
}

jest.unstable_mockModule('linkedin-job-scraper', () => ({
    runScrape: mockRunScrape,
    ScrapeAbortedError,
}));
jest.unstable_mockModule('../../embeddings/jobEmbedding.js', () => ({
    createJobEmbedding: mockCreateJobEmbedding,
}));
jest.unstable_mockModule('./linkedInJobSimilarity.js', () => ({
    computeJobMatch: mockComputeJobMatch,
}));

mockMongoDbModule();
mockLocalDatabaseModule();

const { scrapeJob } = await import('./scrapeJob.js');

function createRequest(body: unknown): Request {
    const emitter = new EventEmitter();
    return Object.assign(emitter, { body }) as unknown as Request;
}

function emitClose(request: Request): void {
    (request as unknown as EventEmitter).emit('close');
}

function createSseResponse(): {
    response: Response;
    writeHead: ReturnType<typeof jest.fn>;
    write: ReturnType<typeof jest.fn>;
    end: ReturnType<typeof jest.fn>;
    status: ReturnType<typeof jest.fn<(statusCode: number) => Response>>;
    json: ReturnType<typeof jest.fn<(body: unknown) => Response>>;
} {
    const writeHead = jest.fn();
    const write = jest.fn();
    const end = jest.fn();
    const status = jest.fn<(statusCode: number) => Response>();
    const json = jest.fn<(body: unknown) => Response>();
    const response = {
        writeHead,
        write,
        end,
        status,
        json,
    } as unknown as Response;

    status.mockReturnValue(response);
    json.mockReturnValue(response);

    return { response, writeHead, write, end, status, json };
}

const validBody = {
    keywords: 'TypeScript',
    location: 'Berlin',
    distance: 25,
    datePosted: 'day',
};

function successfulResult(
    overrides: Partial<SuccessfulJobResult> = {},
): SuccessfulJobResult {
    return {
        status: 'success',
        index: 0,
        companyMismatch: false,
        sourceJobIdMismatch: false,
        lateOverlayDetected: false,
        duplicateOfIdx: null,
        scrapedAt: '2026-06-02T00:00:00.000Z',
        title: 'Software Engineer',
        company: 'Acme Corp',
        descriptionText: 'A great job.',
        sourceJobId: '123456789',
        sourceUrl: 'https://www.linkedin.com/jobs/view/123456789/',
        sourceHostname: 'www.linkedin.com',
        companyUrl: 'https://www.linkedin.com/company/acme-corp/',
        companyAddresses: null,
        location: 'Berlin, Germany',
        postedAt: '2026-06-01',
        tags: [],
        ...overrides,
    };
}

function runScrapeWithResult(result: SuccessfulJobResult) {
    mockRunScrape.mockImplementation(async ({ onProgress }) => {
        onProgress?.({ type: 'job:done', result });
        return { results: [], url: '' };
    });
}

function jobDataWrites(write: ReturnType<typeof jest.fn>): string[] {
    return write.mock.calls
        .map(([chunk]) => String(chunk))
        .filter((chunk) => chunk.includes('duplicateKey'));
}

describe('scrapeJob', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        connect.mockResolvedValue(undefined);
        close.mockResolvedValue(undefined);
        connectionStringConfigured.mockReturnValue(true);
        getCollection.mockReturnValue({ findOne });
        mockCreateJobEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
        mockComputeJobMatch.mockResolvedValue(undefined);
    });

    it('computes duplicateKey from sourceJobId and streams new jobs', async () => {
        findOne.mockResolvedValue(null);
        runScrapeWithResult(successfulResult());
        const { response, writeHead, write, end } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(findOne).toHaveBeenCalledWith(
            { duplicateKey: 'linkedin:123456789' },
            { projection: { _id: 1 } },
        );
        expect(writeHead).toHaveBeenCalledWith(
            200,
            expect.objectContaining({ 'content-type': 'text/event-stream' }),
        );
        const jobWrites = jobDataWrites(write);
        expect(jobWrites).toHaveLength(1);
        expect(jobWrites[0]).toContain('"duplicateKey":"linkedin:123456789"');
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(end).toHaveBeenCalledTimes(1);
    });

    it('skips jobs whose duplicateKey is already stored, without embedding them', async () => {
        findOne.mockResolvedValue({ _id: 'existing-job' });
        runScrapeWithResult(successfulResult());
        const { response, write } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(mockCreateJobEmbedding).not.toHaveBeenCalled();
        expect(mockComputeJobMatch).not.toHaveBeenCalled();
        expect(jobDataWrites(write)).toHaveLength(0);
    });

    it('includes a match score computed from the job embedding', async () => {
        findOne.mockResolvedValue(null);
        runScrapeWithResult(successfulResult());
        const { response, write } = createSseResponse();
        mockComputeJobMatch.mockResolvedValue(0.82);

        await scrapeJob(createRequest(validBody), response);

        expect(mockComputeJobMatch).toHaveBeenCalledWith(
            expect.anything(),
            [0.1, 0.2, 0.3],
        );
        const jobWrites = jobDataWrites(write);
        expect(jobWrites[0]).toContain('"match":0.82');
    });

    it('falls back to the normalized source URL when sourceJobId is missing', async () => {
        findOne.mockResolvedValue(null);
        runScrapeWithResult(
            successfulResult({
                sourceJobId: '',
                sourceUrl: 'https://www.linkedin.com/jobs/view/987654321/',
            }),
        );
        const { response, write } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(findOne).toHaveBeenCalledWith(
            {
                duplicateKey: 'https://www.linkedin.com/jobs/view/987654321/',
            },
            { projection: { _id: 1 } },
        );
        const jobWrites = jobDataWrites(write);
        expect(jobWrites[0]).toContain(
            '"duplicateKey":"https://www.linkedin.com/jobs/view/987654321/"',
        );
    });

    it('does not start the stream when MongoDB is not configured', async () => {
        connectionStringConfigured.mockReturnValueOnce(false);
        const { response, writeHead, write, end } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(writeHead).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(end).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
        expect(mockRunScrape).not.toHaveBeenCalled();
    });

    it('closes the MongoDB client when the initial connection fails', async () => {
        connect.mockRejectedValueOnce(new Error('connection refused'));
        const { response, writeHead, status, json } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(close).toHaveBeenCalledTimes(1);
        expect(writeHead).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'Failed to connect to MongoDB.',
            }),
        );
    });

    it("aborts every keyword's runScrape when the client disconnects", async () => {
        findOne.mockResolvedValue(null);
        const request = createRequest(validBody);
        const capturedSignals: (AbortSignal | undefined)[] = [];
        mockRunScrape.mockImplementation(async ({ signal }) => {
            capturedSignals.push(signal);
            return { results: [], url: '' };
        });
        const { response } = createSseResponse();

        const scrapePromise = scrapeJob(request, response);
        emitClose(request);
        await scrapePromise;

        expect(capturedSignals.length).toBeGreaterThan(0);
        expect(
            capturedSignals.every((signal) => signal?.aborted === true),
        ).toBe(true);
    });

    it('does not write an error chunk when a scrape is aborted by disconnect', async () => {
        findOne.mockResolvedValue(null);
        const request = createRequest(validBody);
        mockRunScrape.mockImplementation(async () => {
            throw new ScrapeAbortedError({ results: [], url: '' });
        });
        const { response, write } = createSseResponse();

        const scrapePromise = scrapeJob(request, response);
        emitClose(request);
        await scrapePromise;

        const errorWrites = write.mock.calls.filter(([chunk]) =>
            String(chunk).includes('Scrape failed'),
        );
        expect(errorWrites).toHaveLength(0);
    });

    it('stops forwarding job writes queued before disconnect', async () => {
        findOne.mockResolvedValue(null);
        const request = createRequest(validBody);
        mockRunScrape.mockImplementation(async ({ onProgress }) => {
            emitClose(request);
            onProgress?.({ type: 'job:done', result: successfulResult() });
            return { results: [], url: '' };
        });
        const { response, write } = createSseResponse();

        await scrapeJob(request, response);

        expect(jobDataWrites(write)).toHaveLength(0);
    });
});
