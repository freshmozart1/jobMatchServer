import { type Browser, type Page } from "puppeteer";
type LinkedInLazyLoadResponse = {
    url(): string;
    status(): number;
    request(): {
        method(): string;
    };
};
type LinkedInLazyLoadScrollOptions = {
    maxScrollAttempts?: number;
    responseTimeoutMs?: number;
    scrollSettleMs?: number;
};
export default function waitForLinkedInPage(url: string): Promise<{
    browser: Browser;
    page: Page;
}>;
export declare function scrollLinkedInLazyLoadedJobsUntilComplete(page: Page, options?: LinkedInLazyLoadScrollOptions): Promise<void>;
export declare function isLinkedInSeeMoreJobPostingsResponse(response: LinkedInLazyLoadResponse): boolean;
export {};
//# sourceMappingURL=waitForLinkedInPage.d.ts.map