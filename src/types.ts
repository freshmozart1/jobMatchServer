import type { ObjectId } from "mongodb";

export type LinkedInUrlVariant = "jobPage" | "jobSearchPage";

export type LinkedInJobLinkSearchParams = {
    keywords: string[];
    location: string;
    distance: number;
};

export type LinkedInJobLinksByKeyword = Record<string, string[]>;

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
    embedding: TextEmbedding;
};

export type TextEmbedding = number[];

export type CoverLetterSegmentName = "subject" | "salutation" | "introduction" | "mainBody" | "conclusion" | "greetings";

export type CoverLetterTextSegments = Record<CoverLetterSegmentName, string>;

export type CoverLetterSegment = {
    text: string;
    embedding: TextEmbedding | null;
};

export type StoredCoverLetter = Record<CoverLetterSegmentName, CoverLetterSegment> & {
    jobDuplicateKey?: string;
};

export type CreateJobInDatabaseRequestBody = {
    job: ScrapedJob;
    like: boolean;
};

export type StoredScrapedJob = ScrapedJob & {
    like: boolean;
};

export type ExtractedLinkedInJobPage = {
    title: string | null;
    company: string | null;
    location: string | null;
    descriptionText: string | null;
    postedAt: string | null;
    tags: string[];
};

export type CalculateTokensRequestBody = {
    text: string;
    model?: string | undefined;
};
