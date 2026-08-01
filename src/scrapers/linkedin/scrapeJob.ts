import type { ScrapedJob } from '#types';
import type { Request, Response } from 'express';
import { runScrape } from 'linkedin-job-scraper';
import { createJobEmbedding } from '../../embeddings/jobEmbedding.js';

function getSearchParamsFromRequest(req: Request): {
    keywords: string[];
    location: string;
    datePosted: 'day' | 'month' | 'week';
    distance: number;
} | null {
    if (
        !req.body ||
        typeof req.body !== 'object' ||
        !('keywords' in req.body) ||
        !('location' in req.body) ||
        !('distance' in req.body) ||
        !('datePosted' in req.body)
    ) {
        return null;
    }
    const keywords = req.body.keywords;
    const location = req.body.location;
    const distance = req.body.distance;
    const datePosted = req.body.datePosted;
    const keywordValues = typeof keywords === 'string' ? [keywords] : keywords;
    const trimmedLocation = typeof location === 'string' ? location.trim() : '';

    if (
        !Array.isArray(keywordValues) ||
        keywordValues.length === 0 ||
        trimmedLocation.length === 0 ||
        typeof distance !== 'number' ||
        !Number.isFinite(distance) ||
        !Number.isInteger(distance) ||
        distance <= 0 ||
        typeof datePosted !== 'string' ||
        !['day', 'month', 'week'].includes(datePosted)
    ) {
        return null;
    }

    const trimmedKeywords: string[] = [];
    for (const keywordValue of keywordValues) {
        if (typeof keywordValue !== 'string') {
            return null;
        }

        const trimmedKeyword = keywordValue.trim();

        if (trimmedKeyword.length === 0) {
            return null;
        }

        if (!trimmedKeywords.includes(trimmedKeyword)) {
            trimmedKeywords.push(trimmedKeyword);
        }
    }

    return {
        keywords: trimmedKeywords,
        location: trimmedLocation,
        distance,
        datePosted: datePosted as 'day' | 'month' | 'week',
    };
}

export async function scrapeJob(req: Request, res: Response): Promise<void> {
    const searchParams = getSearchParamsFromRequest(req);
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
                        const rawJob: Omit<ScrapedJob, 'embedding'> = {
                            sourceHostname: e.result.sourceHostname || '',
                            sourceJobId: e.result.sourceJobId || '',
                            sourceUrl: e.result.sourceUrl || '',
                            title: e.result.title || '',
                            company: e.result.company || '',
                            location: e.result.location || '',
                            descriptionText: e.result.descriptionText || '',
                            postedAt: e.result.postedAt || '',
                            scrapedAt: e.result.scrapedAt,
                            tags: e.result.tags || [],
                            duplicateKey: '',
                            companyAddress: {
                                city: '',
                                countryCode: '',
                                postalCode: '',
                                streetAddress: '',
                            },
                        };
                        res.write(
                            `data: ${JSON.stringify({
                                ...rawJob,
                                embedding: await createJobEmbedding(rawJob),
                            })}\n\n`,
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
