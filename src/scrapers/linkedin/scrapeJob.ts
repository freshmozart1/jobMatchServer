import type { ScrapedJob } from '#types';
import type { Request, Response } from 'express';
import { runScrape } from 'linkedin-job-scraper';
import { createJobEmbedding } from '../../embeddings/jobEmbedding.js';
import { getLinkedInJobScraperSearchParamsFromBody } from '#utils/getLinkedInJobScraperSearchParamsFromBody.js';

export async function scrapeJob(req: Request, res: Response): Promise<void> {
    const searchParams = getLinkedInJobScraperSearchParamsFromBody(req.body);
    if (!searchParams) {
        res.status(400).json({ error: 'Invalid request body' });
        return;
    }
    const { keywords, location, distance, datePosted } = searchParams;
    res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'transfer-encoding': 'chunked',
    });
    res.write('ping\n\n');
    const settledScrapes = await Promise.allSettled(
        keywords.map((keyword) =>
            runScrape({
                onProgress: async (e) => {
                    if (e.type === 'job:done') {
                        if (e.result.status !== 'success') {
                            console.error(
                                `LinkedIn scrape failed for job index ${e.result.index}: ${e.result.error}`,
                            );
                            return;
                        }
                        const rawJob: Omit<ScrapedJob, 'embedding'> = {
                            sourceHostname: e.result.sourceHostname,
                            sourceJobId: e.result.sourceJobId,
                            sourceUrl: e.result.sourceUrl,
                            title: e.result.title,
                            company: e.result.company,
                            location: e.result.location,
                            descriptionText: e.result.descriptionText,
                            postedAt: e.result.postedAt,
                            scrapedAt: e.result.scrapedAt,
                            tags: e.result.tags,
                            duplicateKey: '',
                            companyAddresses: (
                                e.result.companyAddresses ?? []
                            ).map((address) => ({
                                streetAddress: address.streetAddress ?? '',
                                city: address.city ?? '',
                                postalCode: address.postalCode ?? '',
                                countryCode: address.countryCode ?? '',
                            })),
                        };
                        res.write(
                            `data: ${JSON.stringify({
                                ...rawJob,
                                embedding: await createJobEmbedding(rawJob),
                            })}\n\n`,
                        );
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
    settledScrapes.forEach((settledScrape) => {
        if (settledScrape.status === 'rejected') {
            console.error('Scrape failed:', settledScrape.reason);
            res.write(
                `data: ${JSON.stringify({ error: 'Scrape failed', reason: settledScrape.reason })}\n\n`,
            );
        }
    });
    res.end();
}
