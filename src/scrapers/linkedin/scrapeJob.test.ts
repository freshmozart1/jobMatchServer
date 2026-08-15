import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type {
    JobCardIdentity,
    ScrapeOutcome,
    ScraperOptions,
    ScrapeProgressEvent,
    SkippedJobResult,
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
    createFind,
    createToArray,
} from '../../testMockModules/mongodb.test.js';
import type { StoredScrapedJob } from '#types';

type MockRunScrapeOptions = {
    onProgress?: (event: ScrapeProgressEvent) => void;
    signal?: AbortSignal;
    scraperOptions?: ScraperOptions;
};

const mockRunScrape =
    jest.fn<(options: MockRunScrapeOptions) => Promise<unknown>>();
const mockCreateJobEmbedding = jest.fn<() => Promise<number[]>>();
const mockComputeJobMatch =
    jest.fn<(...args: unknown[]) => Promise<number | undefined>>();
const findOne = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const find = createFind<StoredScrapedJob>();
const toArray = createToArray<StoredScrapedJob>();

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

function emitClose(target: Request | Response): void {
    (target as unknown as EventEmitter).emit('close');
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
    const response = Object.assign(new EventEmitter(), {
        writeHead,
        write,
        end,
        status,
        json,
    }) as unknown as Response;

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

function skippedResult(
    overrides: Partial<SkippedJobResult> = {},
): SkippedJobResult {
    return {
        status: 'skipped',
        index: 0,
        companyMismatch: false,
        sourceJobIdMismatch: false,
        lateOverlayDetected: false,
        duplicateOfIdx: null,
        scrapedAt: '2026-06-02T00:00:00.000Z',
        title: 'Software Engineer',
        sourceJobId: '123456789',
        sourceUrl: 'https://www.linkedin.com/jobs/view/123456789/',
        sourceHostname: 'www.linkedin.com',
        companyUrl: 'https://www.linkedin.com/company/acme-corp/',
        location: 'Berlin, Germany',
        postedAt: '2026-06-01',
        company: null,
        descriptionText: null,
        companyAddresses: null,
        tags: null,
        ...overrides,
    };
}

function jobCardIdentity(
    overrides: Partial<JobCardIdentity> = {},
): JobCardIdentity {
    return {
        title: 'Software Engineer',
        sourceUrl: 'https://www.linkedin.com/jobs/view/123456789/',
        sourceHostname: 'www.linkedin.com',
        sourceJobId: '123456789',
        companyUrl: 'https://www.linkedin.com/company/acme-corp/',
        location: 'Berlin, Germany',
        postedAt: '2026-06-01',
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
        getCollection.mockReturnValue({ findOne, find });
        find.mockReturnValue({ toArray });
        toArray.mockResolvedValue([]);
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

    it('passes a shouldScrapeJob predicate that skips pre-fetched sourceJobIds', async () => {
        toArray.mockResolvedValue([
            { sourceJobId: 'stored-1' },
            { sourceJobId: 'stored-2' },
        ] as StoredScrapedJob[]);
        let capturedScraperOptions: ScraperOptions | undefined;
        mockRunScrape.mockImplementation(async ({ scraperOptions }) => {
            capturedScraperOptions = scraperOptions;
            return { results: [], url: '' };
        });
        const { response } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(find).toHaveBeenCalledWith(
            {},
            { projection: { sourceJobId: 1 } },
        );
        expect(capturedScraperOptions?.shouldScrapeJob).toBeDefined();
        expect(
            capturedScraperOptions?.shouldScrapeJob?.(
                jobCardIdentity({ sourceJobId: 'stored-1' }),
            ),
        ).toBe(false);
        expect(
            capturedScraperOptions?.shouldScrapeJob?.(
                jobCardIdentity({ sourceJobId: 'not-stored' }),
            ),
        ).toBe(true);
    });

    it("does not forward a job:done event with status 'skipped', and never re-checks it against MongoDB", async () => {
        mockRunScrape.mockImplementation(async ({ onProgress }) => {
            onProgress?.({ type: 'job:done', result: skippedResult() });
            return { results: [], url: '' };
        });
        const { response, write } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(jobDataWrites(write)).toHaveLength(0);
        expect(mockCreateJobEmbedding).not.toHaveBeenCalled();
        expect(mockComputeJobMatch).not.toHaveBeenCalled();
        expect(findOne).not.toHaveBeenCalled();
    });

    it('proceeds with an empty stored-ID set when pre-fetching stored job IDs fails', async () => {
        toArray.mockRejectedValue(new Error('find failed'));
        findOne.mockResolvedValue(null);
        runScrapeWithResult(successfulResult());
        const { response, writeHead, write } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);

        expect(mockRunScrape).toHaveBeenCalled();
        expect(writeHead).toHaveBeenCalledWith(
            200,
            expect.objectContaining({ 'content-type': 'text/event-stream' }),
        );
        expect(jobDataWrites(write)).toHaveLength(1);
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
        emitClose(response);
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
        emitClose(response);
        await scrapePromise;

        const errorWrites = write.mock.calls.filter(([chunk]) =>
            String(chunk).includes('Scrape failed'),
        );
        expect(errorWrites).toHaveLength(0);
    });

    it('stops forwarding job writes queued before disconnect', async () => {
        findOne.mockResolvedValue(null);
        const request = createRequest(validBody);
        const { response, write } = createSseResponse();
        mockRunScrape.mockImplementation(async ({ onProgress }) => {
            emitClose(response);
            onProgress?.({ type: 'job:done', result: successfulResult() });
            return { results: [], url: '' };
        });

        await scrapeJob(request, response);

        expect(jobDataWrites(write)).toHaveLength(0);
        expect(findOne).not.toHaveBeenCalled();
        expect(mockCreateJobEmbedding).not.toHaveBeenCalled();
        expect(mockComputeJobMatch).not.toHaveBeenCalled();
    });

    it("aborts every keyword's runScrape when the response emits error", async () => {
        findOne.mockResolvedValue(null);
        const request = createRequest(validBody);
        const capturedSignals: (AbortSignal | undefined)[] = [];
        mockRunScrape.mockImplementation(async ({ signal }) => {
            capturedSignals.push(signal);
            return { results: [], url: '' };
        });
        const { response } = createSseResponse();

        const scrapePromise = scrapeJob(request, response);
        (response as unknown as EventEmitter).emit(
            'error',
            new Error('socket hang up'),
        );
        await scrapePromise;

        expect(capturedSignals.length).toBeGreaterThan(0);
        expect(
            capturedSignals.every((signal) => signal?.aborted === true),
        ).toBe(true);
    });

    it('tolerates the response emitting close after a normal completion', async () => {
        findOne.mockResolvedValue(null);
        runScrapeWithResult(successfulResult());
        const { response, write, end } = createSseResponse();

        await scrapeJob(createRequest(validBody), response);
        expect(() => emitClose(response)).not.toThrow();

        expect(jobDataWrites(write)).toHaveLength(1);
        expect(end).toHaveBeenCalledTimes(1);
    });

    it('does not abort the scrape when the request emits close (only the response controls disconnect detection)', async () => {
        findOne.mockResolvedValue(null);
        const request = createRequest(validBody);
        const capturedSignals: (AbortSignal | undefined)[] = [];
        mockRunScrape.mockImplementation(async ({ onProgress, signal }) => {
            capturedSignals.push(signal);
            onProgress?.({ type: 'job:done', result: successfulResult() });
            return { results: [], url: '' };
        });
        const { response, write, end } = createSseResponse();

        const scrapePromise = scrapeJob(request, response);
        emitClose(request);
        await scrapePromise;

        expect(capturedSignals.length).toBeGreaterThan(0);
        expect(
            capturedSignals.every((signal) => signal?.aborted === false),
        ).toBe(true);
        expect(jobDataWrites(write)).toHaveLength(1);
        expect(end).toHaveBeenCalledTimes(1);
    });
});
