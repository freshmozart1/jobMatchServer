import type { ScrapedJob, StoredScrapedJob } from '#types';
import type { Request, Response } from 'express';
import type { SuccessfulJobResult } from 'linkedin-job-scraper';
import { runScrape } from 'linkedin-job-scraper';
import { MongoClient } from 'mongodb';
import {
    connectionStringConfigured,
    getCollection,
    MONGODB_CONNECTION,
} from '#database/database.js';
import { createErrorMessage } from '../../errors/createErrorMessage.js';
import { createJobEmbedding } from '../../embeddings/jobEmbedding.js';
import { getLinkedInJobScraperSearchParamsFromBody } from '#utils/getLinkedInJobScraperSearchParamsFromBody.js';
import { normalizeLinkedInJobPageUrl } from './linkedInJobPageUrl.js';

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

export async function scrapeJob(req: Request, res: Response): Promise<void> {
    const searchParams = getLinkedInJobScraperSearchParamsFromBody(req.body);
    if (!searchParams) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
    }
    if (!connectionStringConfigured(res)) return;

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
    res.write('ping\n\n');

    const pendingJobWrites: Promise<void>[] = [];

    async function forwardJobIfNew(result: SuccessfulJobResult) {
        const duplicateKey = result.sourceJobId
            ? `linkedin:${result.sourceJobId}`
            : (normalizeLinkedInJobPageUrl(result.sourceUrl) ??
              result.sourceUrl);

        if (await isJobAlreadyStored(client, duplicateKey)) {
            console.log(`Skipping already-stored job ${duplicateKey}.`);
            return;
        }

        const rawJob: Omit<ScrapedJob, 'embedding'> = {
            sourceHostname: result.sourceHostname,
            sourceJobId: result.sourceJobId,
            sourceUrl: result.sourceUrl,
            title: result.title,
            company: result.company,
            location: result.location,
            descriptionText: result.descriptionText,
            postedAt: result.postedAt,
            scrapedAt: result.scrapedAt,
            tags: result.tags,
            duplicateKey,
            companyAddresses: (result.companyAddresses ?? []).map(
                (address) => ({
                    streetAddress: address.streetAddress ?? '',
                    city: address.city ?? '',
                    postalCode: address.postalCode ?? '',
                    countryCode: address.countryCode ?? '',
                }),
            ),
        };
        res.write(
            `data: ${JSON.stringify({
                ...rawJob,
                embedding: await createJobEmbedding(rawJob),
            })}\n\n`,
        );
    }

    try {
        const settledScrapes = await Promise.allSettled(
            keywords.map((keyword) =>
                runScrape({
                    onProgress: (e) => {
                        if (e.type === 'job:done') {
                            if (e.result.status !== 'success') {
                                console.error(
                                    `LinkedIn scrape failed for job index ${e.result.index}: ${e.result.error}`,
                                );
                                return;
                            }
                            pendingJobWrites.push(forwardJobIfNew(e.result));
                        } else if (e.type === 'job:stale') {
                            console.warn(
                                `LinkedIn scrape result for job index ${e.result.index} is suspect (companyMismatch=${e.result.companyMismatch}, sourceJobIdMismatch=${e.result.sourceJobIdMismatch}, lateOverlayDetected=${e.result.lateOverlayDetected}); not forwarding it.`,
                            );
                        }
                    },
                    searchParams: {
                        keyword,
                        datePosted,
                        location,
                        distanceMiles: distance,
                    },
                }),
            ),
        );
        await Promise.allSettled(pendingJobWrites);
        settledScrapes.forEach((settledScrape) => {
            if (settledScrape.status === 'rejected') {
                console.error('Scrape failed:', settledScrape.reason);
                res.write(
                    `data: ${JSON.stringify({ error: 'Scrape failed', reason: settledScrape.reason })}\n\n`,
                );
            }
        });
    } finally {
        await client.close();
    }
    res.end();
}
