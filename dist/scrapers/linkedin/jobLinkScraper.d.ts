import type { Request, Response } from "express";
export declare function scrapeLinkedInJobLinks(request: Request, response: Response): Promise<void>;
export declare function getScraperErrorStatus(error: unknown): number;
export declare function getErrorMessage(error: unknown): string;
export declare function isSupportedLinkedInUrl(searchUrl: string): boolean;
//# sourceMappingURL=jobLinkScraper.d.ts.map