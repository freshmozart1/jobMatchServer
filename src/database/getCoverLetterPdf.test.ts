import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoredCoverLetter, StoredScrapedJob, StoredUser } from '#types';
import {
  getCollection,
  mockLocalDatabaseModule,
} from '../testMockModules/localDatabase.test.js';
import {
  close,
  connect,
  mockMongoDbModule,
} from '../testMockModules/mongodb.test.js';
import { createJob, duplicateKey } from '../testHelpers/createJob.test.js';
import createJobDuplicateKeyRequest from '../testHelpers/createJobDuplicateKeyRequest.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import mockResponseWithHeaders from '../testHelpers/mockResponseWithHeaders.test.js';

const findOneCoverLetter =
  jest.fn<
    (
      filter: unknown,
    ) => Promise<
      (StoredCoverLetter & { _id: { toHexString: () => string } }) | null
    >
  >();
const findOneJob =
  jest.fn<
    (
      filter: unknown,
    ) => Promise<
      (StoredScrapedJob & { _id: { toHexString: () => string } }) | null
    >
  >();
const findOneUser = jest.fn<(filter: unknown) => Promise<StoredUser | null>>();

type MockPdfOptions = { format?: string };
type MockSetContentOptions = { waitUntil?: string };
type MockPage = {
  setContent: (html: string, options?: MockSetContentOptions) => Promise<void>;
  pdf: (options?: MockPdfOptions) => Promise<Uint8Array>;
  close: () => Promise<void>;
};
type MockBrowser = {
  newPage: () => Promise<MockPage>;
  close: () => Promise<void>;
};

const mockPdf = jest.fn<(options?: MockPdfOptions) => Promise<Uint8Array>>();
const mockSetContent =
  jest.fn<(html: string, options?: MockSetContentOptions) => Promise<void>>();
const mockPageClose = jest.fn<() => Promise<void>>();
const mockBrowserClose = jest.fn<() => Promise<void>>();
const mockNewPage = jest.fn<() => Promise<MockPage>>();
const mockLaunch = jest.fn<() => Promise<MockBrowser>>();

const mockJobId = '507f1f77bcf86cd799439011';

const mockUser: StoredUser = {
  name: 'Jane Doe',
  email: 'jane.doe@example.com',
  tel: '+49 30 12345678',
  address: {
    streetAddress: 'Hauptstraße 1',
    city: 'Berlin',
    postalCode: '10115',
    countryCode: 'DE',
  },
};

const mockCoverLetterPdfBytes = new Uint8Array([1, 2, 3]);

const mockCoverLetter: StoredCoverLetter & {
  _id: { toHexString: () => string };
} = {
  subject: { text: 'Application for Software Engineer', embedding: null },
  salutation: { text: 'Dear Hiring Manager,', embedding: null },
  introduction: { text: 'I am writing to apply.', embedding: null },
  mainBody: { text: 'I have experience.\n\nI am passionate.', embedding: null },
  conclusion: { text: 'Thank you.', embedding: null },
  greetings: { text: 'Best regards,\nJohn Doe', embedding: null },
  jobDuplicateKey: duplicateKey,
  _id: { toHexString: () => mockJobId },
};

mockMongoDbModule();
mockLocalDatabaseModule();

jest.unstable_mockModule('puppeteer', () => ({
  default: { launch: mockLaunch },
}));

const { default: getCoverLetterPdf } = await import('./getCoverLetterPdf.js');

describe('getCoverLetterPdf', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    connect.mockResolvedValue();
    close.mockResolvedValue();

    findOneCoverLetter.mockResolvedValue(mockCoverLetter);
    findOneJob.mockResolvedValue({
      ...createJob<StoredScrapedJob>(true),
      _id: { toHexString: () => mockJobId },
    });
    findOneUser.mockResolvedValue(mockUser);

    getCollection.mockImplementation(
      (_client: unknown, collectionName: unknown) => {
        if (collectionName === 'coverLetters')
          return { findOne: findOneCoverLetter };
        if (collectionName === 'jobs') return { findOne: findOneJob };
        return { findOne: findOneUser };
      },
    );

    mockNewPage.mockResolvedValue({
      setContent: mockSetContent,
      pdf: mockPdf,
      close: mockPageClose,
    });
    mockSetContent.mockResolvedValue();
    mockPageClose.mockResolvedValue();
    mockPdf.mockResolvedValue(mockCoverLetterPdfBytes);
    mockBrowserClose.mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newPage: mockNewPage,
      close: mockBrowserClose,
    });
  });

  it('sends the rendered cover letter PDF when the cover letter and job are found', async () => {
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();
    const { setHeader, end } = mockResponseWithHeaders(response);

    await getCoverLetterPdf(request, response);

    expect(findOneCoverLetter).toHaveBeenCalledWith({
      jobDuplicateKey: duplicateKey,
    });
    expect(findOneJob).toHaveBeenCalledWith({ duplicateKey });
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockSetContent).toHaveBeenCalledWith(
      expect.stringContaining(
        '<div class="subject">Application for Software Engineer</div>',
      ),
      { waitUntil: 'load' },
    );
    expect(mockSetContent).toHaveBeenCalledWith(
      expect.stringContaining('<p>I have experience.</p>'),
      { waitUntil: 'load' },
    );
    expect(mockBrowserClose).toHaveBeenCalledTimes(1);
    expect(mockPageClose).toHaveBeenCalledTimes(1);
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="cover-letter.pdf"',
    );
    expect(end).toHaveBeenCalledWith(Buffer.from(mockCoverLetterPdfBytes));
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the cover letter is not found', async () => {
    findOneCoverLetter.mockResolvedValue(null);
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();

    await getCoverLetterPdf(request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: 'Cover letter not found',
      message: 'Error retrieving cover letter',
    });
    expect(findOneJob).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the job is not found', async () => {
    findOneJob.mockResolvedValue(null);
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();

    await getCoverLetterPdf(request, response);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      error: 'Job not found',
      message: 'Error retrieving cover letter',
    });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the user is not found', async () => {
    findOneUser.mockResolvedValue(null);
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();

    await getCoverLetterPdf(request, response);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: 'User not found',
      message: 'Error retrieving cover letter',
    });
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when connect rejects', async () => {
    connect.mockRejectedValue(new Error('Connection failed'));
    const request = createJobDuplicateKeyRequest(duplicateKey);
    const { response, status, json } = createResponse();

    await getCoverLetterPdf(request, response);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: 'Connection failed',
      message: 'Error retrieving cover letter',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
