export type LinkedInUrlVariant = 'jobPage' | 'jobSearchPage';

export type LinkedInJobLinkSearchParams = {
    keywords: string[];
    location: string;
    distance: number;
    datePosted: string;
};

export type ScrapeJobRequestParams = LinkedInJobLinkSearchParams & {
    maxPages: number;
};

export type CompanyAddress = {
    streetAddress: string;
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
    companyAddresses: CompanyAddress[];
    embedding: TextEmbedding;
    match?: number;
};

export type TextEmbedding = number[];

export type CoverLetterSegmentName =
    | 'subject'
    | 'salutation'
    | 'introduction'
    | 'mainBody'
    | 'conclusion'
    | 'greetings';

export type CoverLetterTextSegments = Record<CoverLetterSegmentName, string>;

export type CoverLetterSegment = {
    text: string;
    embedding: TextEmbedding | null;
};

export type StoredCoverLetter = Record<
    CoverLetterSegmentName,
    CoverLetterSegment
> & {
    jobDuplicateKey?: string;
};

export type StoredCv = {
    jobId: string;
    filePath: string;
};

export type StoredCertificate = {
    jobId: string;
    filePath: string;
    originalName: string;
    mimeType: string;
};

export type StoredUser = {
    name: string;
    email: string;
    tel: string;
    address: CompanyAddress;
};

export type CreateJobInDatabaseRequestBody = {
    job: ScrapedJob;
    like: boolean;
};

export type StoredScrapedJob = ScrapedJob & {
    like: boolean;
};

export type CalculateTokensRequestBody = {
    text: string;
    model?: string | undefined;
};

export type CoverLetterAsTextRequestBody = {
    coverLetterText: string;
    jobDuplicateKey?: string;
};
