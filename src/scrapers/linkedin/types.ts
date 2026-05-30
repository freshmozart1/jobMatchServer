export type ScrapedAnchor = {
    href: string;
    text: string;
    ariaLabel?: string | undefined;
    parentClassNames: string[];
    nearbyText: string;
};

export type ScrapeJobLinksResult = {
    searchUrl: string;
    finalUrl: string;
    pageTitle: string;
    httpStatus: number | null;
    jobLinks: string[];
    count: number;
    isGated: boolean;
    inspectedAnchorCount: number;
    observedLinkPatterns: string[];
};

export type ScrapedJob = {
    sourceHostname: string;
    sourceJobId?: string;
    sourceUrl: string;
    title: string;
    company: string;
    location?: string;
    descriptionText?: string;
    postedAt?: string;
    scrapedAt: string;
    tags?: string[];
    duplicateKey: string;
};
