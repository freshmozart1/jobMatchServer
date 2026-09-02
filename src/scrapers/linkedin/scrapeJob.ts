import type { ScrapedJob, StoredScrapedJob } from '#types';
import type { Request, Response } from 'express';
import type {
    JobCardIdentity,
    ScrapeProgressEvent,
    SuccessfulJobResult,
} from 'linkedin-job-scraper';
import { runScrape, ScrapeAbortedError } from 'linkedin-job-scraper';
import { MongoClient } from 'mongodb';
import {
    connectionStringConfigured,
    getCollection,
    MONGODB_CONNECTION,
} from '#database/database.js';
import { createErrorMessage } from '../../errors/createErrorMessage.js';
import { createJobEmbedding } from '../../embeddings/jobEmbedding.js';
import { getLinkedInJobScraperSearchParamsFromBody } from '#utils/getLinkedInJobScraperSearchParamsFromBody.js';
import { computeJobMatch } from './linkedInJobSimilarity.js';
import { normalizeLinkedInJobPageUrl } from './linkedInJobPageUrl.js';
import {
    coalesceText,
    extractJobTitle,
    normalizeDescription,
} from './linkedInTextUtils.js';

type DisconnectState = { disconnected: boolean };

function writeIfConnected(
    res: Response,
    disconnectState: DisconnectState,
    chunk: string,
): void {
    if (disconnectState.disconnected) return;
    res.write(chunk);
}

async function isJobAlreadyStored(
    client: MongoClient,
    duplicateKey: string,
): Promise<boolean> {
    const existingJob = await getCollection<StoredScrapedJob>(
        client,
        'jobs',
    ).findOne({ duplicateKey }, { projection: { _id: 1 } });
    return existingJob !== null;
}

async function getStoredSourceJobIds(
    client: MongoClient,
): Promise<Set<string>> {
    const jobs = await getCollection<StoredScrapedJob>(client, 'jobs')
        .find({}, { projection: { sourceJobId: 1 } })
        .toArray();
    return new Set(
        jobs
            .map((job) => job.sourceJobId)
            .filter((id): id is string => Boolean(id)),
    );
}

function computeDuplicateKey(result: SuccessfulJobResult): string {
    return result.sourceJobId
        ? `linkedin:${result.sourceJobId}`
        : (normalizeLinkedInJobPageUrl(result.sourceUrl) ?? result.sourceUrl);
}

function buildRawJob(
    result: SuccessfulJobResult,
    duplicateKey: string,
): Omit<ScrapedJob, 'embedding'> {
    const descriptionText = normalizeDescription(result.descriptionText);

    return {
        sourceHostname: result.sourceHostname,
        sourceJobId: result.sourceJobId,
        sourceUrl: result.sourceUrl,
        title: coalesceText(extractJobTitle(result.title)),
        company: coalesceText(result.company),
        location: result.location,
        ...(descriptionText ? { descriptionText } : {}),
        postedAt: result.postedAt,
        scrapedAt: result.scrapedAt,
        tags: result.tags,
        duplicateKey,
        companyAddresses: (result.companyAddresses ?? []).map((address) => ({
            streetAddress: address.streetAddress ?? '',
            city: address.city ?? '',
            postalCode: address.postalCode ?? '',
            countryCode: address.countryCode ?? '',
        })),
    };
}

async function forwardJobIfNew(
    client: MongoClient,
    res: Response,
    disconnectState: DisconnectState,
    result: SuccessfulJobResult,
): Promise<void> {
    if (disconnectState.disconnected) return;

    const duplicateKey = computeDuplicateKey(result);

    if (await isJobAlreadyStored(client, duplicateKey)) {
        console.log(`Skipping already-stored job ${duplicateKey}.`);
        return;
    }

    const rawJob = buildRawJob(result, duplicateKey);
    const embedding = await createJobEmbedding(rawJob);
    const match = await computeJobMatch(client, embedding);
    writeIfConnected(
        res,
        disconnectState,
        `data: ${JSON.stringify({
            ...rawJob,
            embedding,
            ...(match !== undefined ? { match } : {}),
        })}\n\n`,
    );
}

function handleProgressEvent(
    client: MongoClient,
    res: Response,
    disconnectState: DisconnectState,
    pendingJobWrites: Promise<void>[],
    event: ScrapeProgressEvent,
): void {
    if (event.type === 'job:done') {
        switch (event.result.status) {
            case 'failed':
                console.error(
                    `LinkedIn scrape failed for job index ${event.result.index}: ${event.result.error}`,
                );
                return;
            case 'skipped':
                console.log(
                    `Skipping already-stored job ${event.result.sourceJobId} pre-click.`,
                );
                return;
            case 'success':
                pendingJobWrites.push(
                    forwardJobIfNew(client, res, disconnectState, event.result),
                );
                return;
            default:
                // Exhaustiveness guard: if linkedin-job-scraper ever adds a new
                // JobStatus member, this line fails to compile until the switch
                // above is updated to handle it — an unrecognized status must
                // never silently fall through to being forwarded as if successful.
                event.result satisfies never;
                return;
        }
    } else if (event.type === 'job:stale') {
        console.warn(
            `LinkedIn scrape result for job index ${event.result.index} is suspect (companyMismatch=${event.result.companyMismatch}, sourceJobIdMismatch=${event.result.sourceJobIdMismatch}, lateOverlayDetected=${event.result.lateOverlayDetected}); not forwarding it.`,
        );
    }
}

export async function scrapeJob(req: Request, res: Response): Promise<void> {
    const searchParams = getLinkedInJobScraperSearchParamsFromBody(req.body);
    if (!searchParams) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
    }
    if (!connectionStringConfigured(res)) return;

    const controller = new AbortController();
    const disconnectState: DisconnectState = { disconnected: false };
    // Listen on res (the response), not req (the request): req's 'close' fires once the
    // request body has been fully read, which happens almost immediately regardless of
    // whether the client is still connected — that mistake (#117) aborted every scrape
    // before it could start. res's 'close' fires only when the underlying connection
    // actually terminates, whether from a genuine early disconnect or a normal res.end().
    const handleDisconnect = () => {
        disconnectState.disconnected = true;
        controller.abort();
    };
    res.on('close', handleDisconnect);
    res.on('error', handleDisconnect);

    const { keywords, location, distance, datePosted } = searchParams;
    const client = new MongoClient(MONGODB_CONNECTION!);

    try {
        await client.connect();
    } catch (error) {
        createErrorMessage(res, error, 'Failed to connect to MongoDB.');
        await client.close();
        return;
    }

    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
    });
    // Flush the headers so the client's fetch() resolves and the stream opens
    // promptly. A leading colon makes this a valid SSE comment, which every
    // reader — this project's `data: `-only parser included — correctly ignores;
    // the bare 'ping' it replaced (#124) was neither valid SSE nor receivable.
    // This fires once and is not a keepalive: #122 covers repeating it.
    res.write(': ping\n\n');

    const pendingJobWrites: Promise<void>[] = [];

    try {
        // Best-effort performance optimization: if this fetch fails, fall back to
        // an empty set (scrape everything, same as before this optimization
        // existed) rather than aborting the request. This is only a fallback for
        // the fetch itself failing — jobs that shouldScrapeJob below actually
        // skips are never re-checked against MongoDB, since forwardJobIfNew's
        // isJobAlreadyStored only runs for jobs that were fully scraped.
        let storedSourceJobIds: Set<string> = new Set();
        try {
            storedSourceJobIds = await getStoredSourceJobIds(client);
        } catch (error) {
            console.error(
                'Failed to pre-fetch stored job IDs; scraping without pre-click skip.',
                error,
            );
        }

        const shouldScrapeJob = (identity: JobCardIdentity): boolean =>
            !storedSourceJobIds.has(identity.sourceJobId);

        const settledScrapes = await Promise.allSettled(
            keywords.map((keyword) =>
                runScrape({
                    onProgress: (e) =>
                        handleProgressEvent(
                            client,
                            res,
                            disconnectState,
                            pendingJobWrites,
                            e,
                        ),
                    searchParams: {
                        keyword,
                        datePosted,
                        location,
                        distanceMiles: distance,
                    },
                    signal: controller.signal,
                    scraperOptions: { shouldScrapeJob },
                }),
            ),
        );
        await Promise.allSettled(pendingJobWrites);
        settledScrapes.forEach((settledScrape) => {
            if (settledScrape.status !== 'rejected') return;
            if (settledScrape.reason instanceof ScrapeAbortedError) {
                console.log('LinkedIn scrape aborted: client disconnected.');
                return;
            }
            console.error('Scrape failed:', settledScrape.reason);
            writeIfConnected(
                res,
                disconnectState,
                // Send only the message, following createErrorMessage()'s
                // convention: an Error's own fields are non-enumerable, so
                // stringifying the error itself yields `{}` (#124), while
                // spreading it would leak internal state — ScrapeAbortedError,
                // for one, carries the whole partial results array.
                `data: ${JSON.stringify({
                    error: 'Scrape failed',
                    reason:
                        settledScrape.reason instanceof Error
                            ? settledScrape.reason.message
                            : String(settledScrape.reason),
                })}\n\n`,
            );
        });
    } finally {
        await client.close();
    }
    if (!disconnectState.disconnected) res.end();
}
