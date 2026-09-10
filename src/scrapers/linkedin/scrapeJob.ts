import type { ScrapedJob, ScrapeStreamFrame, StoredScrapedJob } from '#types';
import type { Request, Response } from 'express';
import type {
    JobCardIdentity,
    ScrapeProgressEvent,
    SuccessfulJobResult,
} from 'linkedin-job-scraper';
import {
    describeOverlayDiagnostics,
    runScrape,
    ScrapeAbortedError,
} from 'linkedin-job-scraper';
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
type TerminalProgressStatus = 'failed' | 'dropped';
type KeywordProgressState = {
    current: number;
    total: number;
    terminalStatuses: Map<number, TerminalProgressStatus>;
};

const UNKNOWN_FAILURE_REASON = 'Unknown scrape failure';
const KEEPALIVE_INTERVAL_MS = 15_000;
// Exported so the tests assert against this exact string rather than a copy of it that
// could silently drift. It names every field because the previous bare 'Invalid request
// body' told a user who left the UI's "(optional)" location blank nothing at all (#143).
export const INVALID_BODY_ERROR_MESSAGE =
    'Invalid request body. Please provide keywords as a non-empty string or array of non-empty strings, distance as a positive integer, datePosted as "day", "week", or "month", and an optional string location.';

// Reads a non-Error rejection's own `message`: a `{ message, code }` object or
// a cross-realm Error fails `instanceof` yet still carries a real message, one
// `String()` would flatten to "[object Object]". Only `message` is read, so no
// other field of the rejection can reach the wire.
function errorLikeMessage(reason: unknown): string | undefined {
    const message = (reason as { message?: unknown } | null | undefined)
        ?.message;
    return typeof message === 'string' && message.length > 0
        ? message
        : undefined;
}

// Reduces a rejection value to the single string the failure frame carries.
// Only a message goes on the wire, following createErrorMessage()'s convention:
// an Error's own fields are non-enumerable, so stringifying the error itself
// yields `{}` (#124), while spreading it would leak internal state.
//
// Every fallback is load-bearing:
//   - `message || name`: `new Error().message` is `''`, and an empty reason is
//     falsy on the client — as uninformative as the `{}` it replaced.
//   - `errorLikeMessage`: see above.
//   - the try/catch: `String()` throws on a null-prototype object (or anything
//     else lacking `toString`/`valueOf`), and a throw here would escape past
//     scrapeJob's `res.end()` and strand the SSE stream open.
//
// The result is a raw scraper/Playwright message and this endpoint has no auth
// (see CLAUDE.md), so the frame deliberately discloses internal failure detail
// to any caller — acceptable for a single-user service, but not free.
function describeFailureReason(reason: unknown): string {
    if (reason instanceof Error) {
        return reason.message || reason.name || UNKNOWN_FAILURE_REASON;
    }
    const errorLike = errorLikeMessage(reason);
    if (errorLike !== undefined) return errorLike;
    try {
        return String(reason) || UNKNOWN_FAILURE_REASON;
    } catch {
        return UNKNOWN_FAILURE_REASON;
    }
}

function writeIfConnected(
    res: Response,
    disconnectState: DisconnectState,
    chunk: string,
): void {
    if (disconnectState.disconnected) return;
    res.write(chunk);
}

function writeSseFrame(
    res: Response,
    disconnectState: DisconnectState,
    frame: ScrapeStreamFrame,
): void {
    writeIfConnected(
        res,
        disconnectState,
        `data: ${JSON.stringify(frame)}\n\n`,
    );
}

function writeScanningProgress(
    res: Response,
    disconnectState: DisconnectState,
    keyword: string,
    progressState: KeywordProgressState,
): void {
    let failed = 0;
    let dropped = 0;
    progressState.terminalStatuses.forEach((status) => {
        if (status === 'failed') failed++;
        else dropped++;
    });
    writeSseFrame(res, disconnectState, {
        type: 'progress',
        keyword,
        stage: 'scanning',
        current: progressState.current,
        total: progressState.total,
        failed,
        dropped,
    });
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
    writeSseFrame(res, disconnectState, {
        type: 'job',
        job: {
            ...rawJob,
            embedding,
            ...(match !== undefined ? { match } : {}),
        },
    });
}

function handleProgressEvent(
    client: MongoClient,
    res: Response,
    disconnectState: DisconnectState,
    pendingJobWrites: Promise<void>[],
    keyword: string,
    progressState: KeywordProgressState,
    event: ScrapeProgressEvent,
): void {
    switch (event.type) {
        case 'job:done':
            progressState.current = event.result.index + 1;
            switch (event.result.status) {
                case 'failed': {
                    progressState.terminalStatuses.set(
                        event.result.index,
                        'failed',
                    );
                    const failureReason = event.result.failureReason
                        ? `, failureReason=${event.result.failureReason}`
                        : '';
                    console.error(
                        `LinkedIn scrape failed for job index ${event.result.index}${failureReason}: ${event.result.error}`,
                    );
                    break;
                }
                case 'skipped':
                    progressState.terminalStatuses.delete(event.result.index);
                    console.log(
                        `Skipping already-stored job ${event.result.sourceJobId} pre-click.`,
                    );
                    break;
                case 'success':
                    progressState.terminalStatuses.delete(event.result.index);
                    pendingJobWrites.push(
                        forwardJobIfNew(
                            client,
                            res,
                            disconnectState,
                            event.result,
                        ),
                    );
                    break;
                default:
                    // Exhaustiveness guard: if linkedin-job-scraper ever adds a new
                    // JobStatus member, this line fails to compile until the switch
                    // above is updated to handle it — an unrecognized status must
                    // never silently fall through to being forwarded as if successful.
                    event.result satisfies never;
                    return;
            }
            writeScanningProgress(res, disconnectState, keyword, progressState);
            return;
        case 'job:stale':
            progressState.current = event.result.index + 1;
            progressState.terminalStatuses.set(event.result.index, 'dropped');
            console.warn(
                `LinkedIn scrape result for job index ${event.result.index} is suspect (companyMismatch=${event.result.companyMismatch}, sourceJobIdMismatch=${event.result.sourceJobIdMismatch}, lateOverlayDetected=${event.result.lateOverlayDetected}); not forwarding it.`,
            );
            writeScanningProgress(res, disconnectState, keyword, progressState);
            return;
        case 'overlay:undismissed':
            console.warn(
                `LinkedIn blocking overlay ${event.neutralized ? 'was neutralized' : 'remains blocking'}: ${describeOverlayDiagnostics(event.diagnostics)}`,
            );
            return;
        case 'jobs:loading':
            writeSseFrame(res, disconnectState, {
                type: 'progress',
                keyword,
                stage: 'loading',
                discovered: event.count,
            });
            return;
        case 'jobs:found':
            progressState.current = 0;
            progressState.total = event.total;
            progressState.terminalStatuses.clear();
            writeScanningProgress(res, disconnectState, keyword, progressState);
            return;
        case 'job:start':
            progressState.current = event.index + 1;
            progressState.total = event.total;
            writeScanningProgress(res, disconnectState, keyword, progressState);
            return;
        default:
            // Keep the outer progress-event union exhaustive as the dependency evolves.
            event satisfies never;
    }
}

export async function scrapeJob(req: Request, res: Response): Promise<void> {
    const searchParams = getLinkedInJobScraperSearchParamsFromBody(req.body);
    if (!searchParams) {
        res.status(400).json({ error: INVALID_BODY_ERROR_MESSAGE });
        return;
    }
    if (!connectionStringConfigured(res)) return;

    const controller = new AbortController();
    const disconnectState: DisconnectState = { disconnected: false };
    let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
    const stopKeepalive = () => {
        if (keepaliveTimer === undefined) return;
        clearInterval(keepaliveTimer);
        keepaliveTimer = undefined;
    };
    // Listen on res (the response), not req (the request): req's 'close' fires once the
    // request body has been fully read, which happens almost immediately regardless of
    // whether the client is still connected — that mistake (#117) aborted every scrape
    // before it could start. res's 'close' fires only when the underlying connection
    // actually terminates, whether from a genuine early disconnect or a normal res.end().
    const handleDisconnect = () => {
        disconnectState.disconnected = true;
        stopKeepalive();
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
    // promptly. The leading colon makes this an SSE comment, which every reader
    // — this project's `data: `-only parser included — ignores. The bare 'ping'
    // it replaced (#124) was ignored too, as a line with no colon is parsed as a
    // field named `ping`, which is not one of SSE's four recognized field names;
    // a comment is simply the frame the format actually provides for this. A
    // separate periodic comment below keeps the connection active afterward.
    writeIfConnected(res, disconnectState, ': ping\n\n');
    keepaliveTimer = setInterval(
        () => writeIfConnected(res, disconnectState, ': keepalive\n\n'),
        KEEPALIVE_INTERVAL_MS,
    );

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
            keywords.map((keyword) => {
                const progressState: KeywordProgressState = {
                    current: 0,
                    total: 0,
                    terminalStatuses: new Map(),
                };
                return runScrape({
                    onProgress: (e) =>
                        handleProgressEvent(
                            client,
                            res,
                            disconnectState,
                            pendingJobWrites,
                            keyword,
                            progressState,
                            e,
                        ),
                    searchParams: {
                        keyword,
                        datePosted,
                        ...(location !== undefined ? { location } : {}),
                        distanceMiles: distance,
                    },
                    signal: controller.signal,
                    scraperOptions: { shouldScrapeJob },
                });
            }),
        );
        await Promise.allSettled(pendingJobWrites);
        settledScrapes.forEach((settledScrape, index) => {
            if (settledScrape.status !== 'rejected') return;
            if (settledScrape.reason instanceof ScrapeAbortedError) {
                console.log('LinkedIn scrape aborted: client disconnected.');
                return;
            }
            console.error('Scrape failed:', settledScrape.reason);
            const keyword = keywords[index];
            writeSseFrame(
                res,
                disconnectState,
                // Only a message, never the error object: see
                // describeFailureReason. Any Error subclass with own enumerable
                // fields would otherwise put internal state on the wire —
                // ScrapeAbortedError's partial results array is the shape to
                // picture, though that one never reaches here, having returned
                // above.
                {
                    type: 'error',
                    error: 'Scrape failed',
                    reason: describeFailureReason(settledScrape.reason),
                    ...(keyword !== undefined ? { keyword } : {}),
                },
            );
        });
    } finally {
        stopKeepalive();
        await client.close();
    }
    if (!disconnectState.disconnected) res.end();
}
