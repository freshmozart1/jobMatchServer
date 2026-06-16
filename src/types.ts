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

export type CompanyAddress = {
    street: string;
    housenumber: number;
    city: string;
    postalCode: string;
    countryCode: string;
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
    companyAddress: CompanyAddress;
    embedding: TextEmbedding;
    cosineSimilarity?: number;
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

export type StoredCv = {
    jobId: string;
    filePath: string;
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
    companyPageUrl: string;
};

export type CalculateTokensRequestBody = {
    text: string;
    model?: string | undefined;
};

export type CoverLetterAsTextRequestBody = {
    coverLetterText: string;
    jobDuplicateKey?: string;
};