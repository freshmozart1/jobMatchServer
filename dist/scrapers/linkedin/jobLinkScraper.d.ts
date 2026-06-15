import type { Request, Response } from "express";
import type { LinkedInJobLinkSearchParams } from "#types";
export declare function scrapeLinkedInJobLinks(request: Request, response: Response): Promise<void>;
export declare function getScraperErrorStatus(error: unknown): number;
export declare function getLinkedInJobLinkSearchParamsFromBody(body: unknown): LinkedInJobLinkSearchParams | null;
//# sourceMappingURL=jobLinkScraper.d.ts.map