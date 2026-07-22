import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';
import type { CompanyAddress, ExtractedLinkedInJobPage } from '#types';
import createResponse from '../../../testHelpers/createResponse.test.js';
import {
  mockLocalDatabaseModule,
  connectionStringConfigured,
  getCollection,
} from '../../../testMockModules/localDatabase.test.js';
import {
  mockMongoDbModule,
  connect,
  close,
} from '../../../testMockModules/mongodb.test.js';

type SearchResult = {
  detailUrl: string | null;
  extracted: ExtractedLinkedInJobPage;
};

type SearchResultsExtraction = {
  results: SearchResult[];
  aborted: boolean;
};

const mockWaitForLinkedInPage = jest.fn<
  () => Promise<{
    browserServer: { close: () => Promise<void>; kill: () => Promise<void> };
    page: object;
  }>
>();
const mockExtractLinkedInJobSearchResults =
  jest.fn<() => Promise<SearchResultsExtraction>>();
const mockExtractCompanyAddress = jest.fn<() => Promise<CompanyAddress>>();
const mockCreateJobEmbedding = jest.fn<() => Promise<number[]>>();
const mockComputeJobMatch = jest.fn<() => Promise<number | undefined>>();

jest.unstable_mockModule('./waitForLinkedInPage.js', () => ({
  default: mockWaitForLinkedInPage,
  LINKEDIN_USER_AGENT: 'test-user-agent',
}));
jest.unstable_mockModule('./extractLinkedInJobSearchResults.js', () => ({
  extractLinkedInJobSearchResults: mockExtractLinkedInJobSearchResults,
}));
jest.unstable_mockModule('./extractCompanyAddress.js', () => ({
  extractCompanyAddress: mockExtractCompanyAddress,
}));
jest.unstable_mockModule('../linkedInJobSimilarity.js', () => ({
  computeJobMatch: mockComputeJobMatch,
}));
jest.unstable_mockModule('../../../embeddings/jobEmbedding.js', () => ({
  createJobEmbedding: mockCreateJobEmbedding,
}));

mockMongoDbModule();
mockLocalDatabaseModule();

const { scrapeJob } = await import('./scrapeJobs.js');

function createRequest(body: unknown): Request {
  return { body } as Request;
}

const validBody = {
  keywords: 'TypeScript',
  location: 'Berlin',
  distance: 25,
  datePosted: '86400',
  maxPages: 1,
};

const sampleAddress: CompanyAddress = {
  streetAddress: 'Musterstraße 42',
  city: 'Berlin',
  postalCode: '10115',
  countryCode: 'DE',
};

function sampleResult(
  jobId: string,
  companyPageUrl = 'https://www.linkedin.com/company/acme-corp/',
): SearchResult {
  return {
    detailUrl: `https://www.linkedin.com/jobs/view/${jobId}/`,
    extracted: {
      title: 'Software Engineer',
      company: 'Acme Corp',
      location: 'Berlin, Germany',
      descriptionText: 'A great job.',
      postedAt: '2024-01-15',
      tags: ['Full-time'],
      companyPageUrl,
    },
  };
}

function searchResults(
  results: SearchResult[],
  aborted = false,
): SearchResultsExtraction {
  return { results, aborted };
}

describe('scrapeJob', () => {
  let browserServerClose: ReturnType<typeof jest.fn<() => Promise<void>>>;

  beforeEach(() => {
    jest.clearAllMocks();

    browserServerClose = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    mockWaitForLinkedInPage.mockResolvedValue({
      browserServer: {
        close: browserServerClose,
        kill: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
      page: {},
    });
    mockExtractLinkedInJobSearchResults.mockResolvedValue(searchResults([]));
    mockExtractCompanyAddress.mockResolvedValue(sampleAddress);
    mockCreateJobEmbedding.mockResolvedValue([1, 0, 0]);
    mockComputeJobMatch.mockResolvedValue(undefined);
    connect.mockResolvedValue(undefined);
    close.mockResolvedValue(undefined);
    connectionStringConfigured.mockReturnValue(true);
    getCollection.mockReturnValue({
      find: jest.fn().mockReturnValue({
        toArray: jest
          .fn<() => Promise<{ duplicateKey: string }[]>>()
          .mockResolvedValue([]),
      }),
    });
  });

  it('responds 400 when maxPages is missing from the body', async () => {
    const { response, status, json } = createResponse();
    const bodyWithoutMaxPages = {
      keywords: validBody.keywords,
      location: validBody.location,
      distance: validBody.distance,
      datePosted: validBody.datePosted,
    };

    await scrapeJob(createRequest(bodyWithoutMaxPages), response);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to scrape LinkedIn job links.',
      }),
    );
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it('responds 400 when maxPages is negative', async () => {
    const { response, status } = createResponse();

    await scrapeJob(createRequest({ ...validBody, maxPages: -1 }), response);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
  });

  it('returns early without scraping when MongoDB is not configured', async () => {
    connectionStringConfigured.mockReturnValueOnce(false);
    const { response } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(mockWaitForLinkedInPage).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('stops pagination when a page returns no results', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([]),
    );
    const { response, status, json } = createResponse();

    await scrapeJob(createRequest({ ...validBody, maxPages: 0 }), response);

    expect(status).toHaveBeenCalledWith(200);
    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toEqual([]);
    expect(mockWaitForLinkedInPage).toHaveBeenCalledTimes(1);
  });

  it('stops pagination at maxPages even if pages keep returning results', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValue(
      searchResults([sampleResult('1')]),
    );
    const { response } = createResponse();

    await scrapeJob(createRequest({ ...validBody, maxPages: 2 }), response);

    expect(mockWaitForLinkedInPage).toHaveBeenCalledTimes(2);
  });

  it('continues across pages when maxPages is 0, until a page is empty', async () => {
    mockExtractLinkedInJobSearchResults
      .mockResolvedValueOnce(searchResults([sampleResult('1')]))
      .mockResolvedValueOnce(searchResults([sampleResult('2')]))
      .mockResolvedValueOnce(searchResults([]));
    const { response } = createResponse();

    await scrapeJob(createRequest({ ...validBody, maxPages: 0 }), response);

    expect(mockWaitForLinkedInPage).toHaveBeenCalledTimes(3);
  });

  it('stops paginating a keyword when job detail extraction aborts due to consecutive failures, but keeps the partial results', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('123456789')], true),
    );
    const { response, status, json } = createResponse();

    await scrapeJob(createRequest({ ...validBody, maxPages: 2 }), response);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockWaitForLinkedInPage).toHaveBeenCalledTimes(1);
    expect(browserServerClose).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toHaveLength(1);
  });

  it('computes an embedding and match for every scraped job and includes them in the response', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('123456789')]),
    );
    mockComputeJobMatch.mockResolvedValueOnce(0.42);
    const { response, status, json } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockCreateJobEmbedding).toHaveBeenCalledTimes(1);
    expect(mockComputeJobMatch).toHaveBeenCalledTimes(1);

    const body = json.mock.calls[0]?.[0] as Record<
      string,
      { searchUrl: string; jobs: Record<string, unknown>[] }
    >;
    expect(body['TypeScript']?.searchUrl).toContain('pageNum=0');
    expect(body['TypeScript']?.jobs[0]).toMatchObject({
      sourceHostname: 'www.linkedin.com',
      sourceJobId: '123456789',
      title: 'Software Engineer',
      company: 'Acme Corp',
      duplicateKey: 'linkedin:123456789',
      match: 0.42,
    });
  });

  it('skips a job when no company page link was found, without failing the request', async () => {
    const noCompanyResult = sampleResult('1');
    noCompanyResult.extracted = {
      ...noCompanyResult.extracted,
      companyPageUrl: '',
    };
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([noCompanyResult]),
    );
    const { response, json } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toEqual([]);
    expect(mockExtractCompanyAddress).not.toHaveBeenCalled();
  });

  it('retries company address extraction after first failure and skips if retry also fails', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('1')]),
    );
    // First attempt fails, retry also fails.
    mockExtractCompanyAddress.mockRejectedValueOnce(new Error('no address'));
    mockExtractCompanyAddress.mockRejectedValueOnce(
      new Error('retry also fails'),
    );
    const { response, status, json } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(browserServerClose).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(200);
    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(2);
    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toEqual([]);
  });

  it('retries company address extraction and pushes job when retry succeeds', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('123456789')]),
    );
    // First attempt fails, retry succeeds.
    mockExtractCompanyAddress.mockRejectedValueOnce(new Error('no address'));
    mockExtractCompanyAddress.mockResolvedValueOnce(sampleAddress);
    mockComputeJobMatch.mockResolvedValueOnce(0.42);
    const { response, status, json } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(2);
    const body = json.mock.calls[0]?.[0] as Record<
      string,
      { jobs: Record<string, unknown>[] }
    >;
    expect(body['TypeScript']?.jobs).toHaveLength(1);
    expect(body['TypeScript']?.jobs[0]).toMatchObject({
      sourceJobId: '123456789',
      duplicateKey: 'linkedin:123456789',
      match: 0.42,
    });
  });

  it('logs company address retry attempts with console.log', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);

    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('1')]),
    );
    mockExtractCompanyAddress.mockRejectedValueOnce(new Error('no address'));
    mockExtractCompanyAddress.mockRejectedValueOnce(
      new Error('still no address'),
    );
    const { response } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    const logged = logSpy.mock.calls.map((args) => String(args[0]));
    expect(logged.some((msg) => msg.includes('scheduling retry'))).toBe(true);
    expect(logged.some((msg) => msg.includes('Retrying'))).toBe(true);
    expect(logged.some((msg) => msg.includes('retry failed'))).toBe(true);

    logSpy.mockRestore();
  });

  it('maps a timeout failure to a 504 response', async () => {
    mockWaitForLinkedInPage.mockRejectedValueOnce(
      new Error('Navigation timeout exceeded'),
    );
    const { response, status } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(status).toHaveBeenCalledWith(504);
  });

  it('always closes the MongoDB client', async () => {
    const { response } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached company address for a second job from the same company in one page', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('111'), sampleResult('222')]),
    );
    const { response, json } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0]?.[0] as Record<
      string,
      { jobs: Record<string, unknown>[] }
    >;
    expect(body['TypeScript']?.jobs).toHaveLength(2);
    expect(body['TypeScript']?.jobs[0]?.['companyAddress']).toEqual(
      sampleAddress,
    );
    expect(body['TypeScript']?.jobs[1]?.['companyAddress']).toEqual(
      sampleAddress,
    );
  });

  it('dedupes a failed-then-retried company address across two jobs from the same company', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([sampleResult('111'), sampleResult('222')]),
    );
    // First-pass fails once for the shared company; the single deduped retry succeeds.
    mockExtractCompanyAddress.mockRejectedValueOnce(new Error('no address'));
    mockExtractCompanyAddress.mockResolvedValueOnce(sampleAddress);
    const { response, json } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(2);
    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toHaveLength(2);
  });

  it('gives a company a fresh extraction attempt in a later keyword after it permanently failed in an earlier keyword', async () => {
    mockExtractLinkedInJobSearchResults
      .mockResolvedValueOnce(searchResults([sampleResult('111')])) // keyword 1
      .mockResolvedValueOnce(searchResults([sampleResult('222')])); // keyword 2
    // Keyword 1: first-pass fails, retry fails too -> company marked failed for keyword 1 only.
    mockExtractCompanyAddress.mockRejectedValueOnce(new Error('fail 1'));
    mockExtractCompanyAddress.mockRejectedValueOnce(new Error('fail 2'));
    // Keyword 2: fresh attempt succeeds immediately (not skipped).
    mockExtractCompanyAddress.mockResolvedValueOnce(sampleAddress);
    const { response, json } = createResponse();

    await scrapeJob(
      createRequest({
        ...validBody,
        keywords: ['TypeScript', 'JavaScript'],
      }),
      response,
    );

    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(3);
    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toEqual([]);
    expect(body['JavaScript']?.jobs).toHaveLength(1);
  });

  it('reuses a cached company address across keywords for the same company', async () => {
    mockExtractLinkedInJobSearchResults
      .mockResolvedValueOnce(searchResults([sampleResult('111')])) // keyword 1
      .mockResolvedValueOnce(searchResults([sampleResult('222')])); // keyword 2
    const { response, json } = createResponse();

    await scrapeJob(
      createRequest({
        ...validBody,
        keywords: ['TypeScript', 'JavaScript'],
      }),
      response,
    );

    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0]?.[0] as Record<string, { jobs: unknown[] }>;
    expect(body['TypeScript']?.jobs).toHaveLength(1);
    expect(body['JavaScript']?.jobs).toHaveLength(1);
  });

  it('does not merge two different companies into the same cache entry', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([
        sampleResult('111', 'https://www.linkedin.com/company/acme-corp/'),
        sampleResult('222', 'https://uk.linkedin.com/company/other-co/?trk=x'),
      ]),
    );
    const { response } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(2);
  });

  it('treats locale-subdomain variants of the same company as one cache entry', async () => {
    mockExtractLinkedInJobSearchResults.mockResolvedValueOnce(
      searchResults([
        sampleResult(
          '111',
          'https://uk.linkedin.com/company/quantumblack?trk=a',
        ),
        sampleResult(
          '222',
          'https://de.linkedin.com/company/quantumblack/?trk=b',
        ),
      ]),
    );
    const { response } = createResponse();

    await scrapeJob(createRequest(validBody), response);

    expect(mockExtractCompanyAddress).toHaveBeenCalledTimes(1);
  });
});
