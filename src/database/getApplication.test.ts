import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import path from "path";
import type { StoredCoverLetter, StoredCv, StoredScrapedJob } from "#types";
import { getCollection, mockLocalDatabaseModule } from "../testMockModules/localDatabase.test.js";
import { close, connect, mockMongoDbModule } from "../testMockModules/mongodb.test.js";
import { createJob, duplicateKey } from "../testHelpers/createJob.test.js";
import createRequest from "../testHelpers/createRequest.test.js";
import createResponse from "../testHelpers/createResponse.test.js";

const findOneCoverLetter = jest.fn<(filter: unknown) => Promise<(StoredCoverLetter & { _id: { toHexString: () => string } }) | null>>();
const findOneJob = jest.fn<(filter: unknown) => Promise<(StoredScrapedJob & { _id: { toHexString: () => string } }) | null>>();
const findOneCv = jest.fn<(filter: unknown) => Promise<StoredCv | null>>();

type MockPdfOptions = { format?: string };
type MockSetContentOptions = { waitUntil?: string };
type MockPage = { setContent: (html: string, options?: MockSetContentOptions) => Promise<void>; pdf: (options?: MockPdfOptions) => Promise<Uint8Array> };
type MockBrowser = { newPage: () => Promise<MockPage>; close: () => Promise<void> };
type MockMergedDoc = { addPage: (page: unknown) => void; copyPages: (doc: unknown, indices: number[]) => Promise<unknown[]>; save: () => Promise<Uint8Array> };
type MockPdfDocRef = { getPageIndices: () => number[] };

const mockPdf = jest.fn<(options?: MockPdfOptions) => Promise<Uint8Array>>();
const mockSetContent = jest.fn<(html: string, options?: MockSetContentOptions) => Promise<void>>();
const mockBrowserClose = jest.fn<() => Promise<void>>();
const mockNewPage = jest.fn<() => Promise<MockPage>>();
const mockLaunch = jest.fn<() => Promise<MockBrowser>>();

const mockAddPage = jest.fn<(page: unknown) => void>();
const mockGetPageIndices = jest.fn<() => number[]>();
const mockCopyPages = jest.fn<(doc: unknown, indices: number[]) => Promise<unknown[]>>();
const mockSave = jest.fn<() => Promise<Uint8Array>>();
const mockPdfDocumentCreate = jest.fn<() => Promise<MockMergedDoc>>();
const mockPdfDocumentLoad = jest.fn<() => Promise<MockPdfDocRef>>();

const mockReadFile = jest.fn<(path: string) => Promise<Buffer>>();

const mockJobId = "507f1f77bcf86cd799439011";

const storedCv: StoredCv = {
    jobId: mockJobId,
    filePath: "uploads/cv/testfile.pdf",
};

const mockCoverLetterPdfBytes = new Uint8Array([1, 2, 3]);
const mockCvBytes = Buffer.from([4, 5, 6]);
const mockMergedBytes = new Uint8Array([7, 8, 9]);

const mockCoverLetter: StoredCoverLetter & { _id: { toHexString: () => string } } = {
    subject: { text: "Application for Software Engineer", embedding: null },
    salutation: { text: "Dear Hiring Manager,", embedding: null },
    introduction: { text: "I am writing to apply.", embedding: null },
    mainBody: { text: "I have experience.\n\nI am passionate.", embedding: null },
    conclusion: { text: "Thank you.", embedding: null },
    greetings: { text: "Best regards,\nJohn Doe", embedding: null },
    jobDuplicateKey: duplicateKey,
    _id: { toHexString: () => mockJobId },
};

mockMongoDbModule();
mockLocalDatabaseModule();

jest.unstable_mockModule("puppeteer", () => ({
    default: { launch: mockLaunch },
}));

jest.unstable_mockModule("pdf-lib", () => ({
    PDFDocument: { create: mockPdfDocumentCreate, load: mockPdfDocumentLoad },
}));

jest.unstable_mockModule("fs/promises", () => ({
    readFile: mockReadFile,
}));

const { default: getApplication } = await import("./getApplication.js");

describe("getApplication", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        connect.mockResolvedValue();
        close.mockResolvedValue();

        findOneCoverLetter.mockResolvedValue(mockCoverLetter);
        findOneJob.mockResolvedValue({ ...createJob<StoredScrapedJob>(true), _id: { toHexString: () => mockJobId } });
        findOneCv.mockResolvedValue(storedCv);

        getCollection.mockImplementation((_client: unknown, collectionName: unknown) => {
            if (collectionName === "coverLetters") return { findOne: findOneCoverLetter };
            if (collectionName === "jobs") return { findOne: findOneJob };
            return { findOne: findOneCv };
        });

        mockNewPage.mockResolvedValue({ setContent: mockSetContent, pdf: mockPdf });
        mockSetContent.mockResolvedValue();
        mockPdf.mockResolvedValue(mockCoverLetterPdfBytes);
        mockBrowserClose.mockResolvedValue(undefined);
        mockLaunch.mockResolvedValue({ newPage: mockNewPage, close: mockBrowserClose });

        const mockMergedDoc = { addPage: mockAddPage, copyPages: mockCopyPages, save: mockSave };
        mockPdfDocumentCreate.mockResolvedValue(mockMergedDoc);
        mockPdfDocumentLoad.mockResolvedValue({ getPageIndices: mockGetPageIndices });
        mockGetPageIndices.mockReturnValue([0]);
        mockCopyPages.mockResolvedValue([{}]);
        mockSave.mockResolvedValue(mockMergedBytes);

        mockReadFile.mockResolvedValue(mockCvBytes);
    });

    it("sends merged application PDF when all documents are found", async () => {
        const request = createRequest<object, never, { jobDuplicateKey: string }>({ params: { jobDuplicateKey: duplicateKey } });
        const { response, status, json } = createResponse();
        const setHeader = jest.fn<(name: string, value: string) => void>();
        const end = jest.fn<(data: Buffer) => void>();
        (response as unknown as { setHeader: typeof setHeader; end: typeof end }).setHeader = setHeader;
        (response as unknown as { setHeader: typeof setHeader; end: typeof end }).end = end;

        await getApplication(request, response);

        expect(findOneCoverLetter).toHaveBeenCalledWith({ jobDuplicateKey: duplicateKey });
        expect(findOneJob).toHaveBeenCalledWith({ duplicateKey });
        expect(findOneCv).toHaveBeenCalledWith({ jobId: mockJobId });
        expect(mockLaunch).toHaveBeenCalledTimes(1);
        expect(mockSetContent).toHaveBeenCalledWith(
            expect.stringContaining("<p>Application for Software Engineer</p>"),
            { waitUntil: "load" },
        );
        expect(mockSetContent).toHaveBeenCalledWith(
            expect.stringContaining("<p>I have experience.</p>"),
            { waitUntil: "load" },
        );
        expect(mockBrowserClose).toHaveBeenCalledTimes(1);
        expect(mockReadFile).toHaveBeenCalledWith(path.resolve(storedCv.filePath));
        expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
        expect(setHeader).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="application.pdf"');
        expect(end).toHaveBeenCalledWith(Buffer.from(mockMergedBytes));
        expect(status).not.toHaveBeenCalled();
        expect(json).not.toHaveBeenCalled();
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when the cover letter is not found", async () => {
        findOneCoverLetter.mockResolvedValue(null);
        const request = createRequest<object, never, { jobDuplicateKey: string }>({ params: { jobDuplicateKey: duplicateKey } });
        const { response, status, json } = createResponse();

        await getApplication(request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({ error: "Cover letter not found", message: "Error retrieving application" });
        expect(findOneJob).not.toHaveBeenCalled();
        expect(findOneCv).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when the job is not found", async () => {
        findOneJob.mockResolvedValue(null);
        const request = createRequest<object, never, { jobDuplicateKey: string }>({ params: { jobDuplicateKey: duplicateKey } });
        const { response, status, json } = createResponse();

        await getApplication(request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({ error: "Job not found", message: "Error retrieving application" });
        expect(findOneCv).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 404 when the CV is not found", async () => {
        findOneCv.mockResolvedValue(null);
        const request = createRequest<object, never, { jobDuplicateKey: string }>({ params: { jobDuplicateKey: duplicateKey } });
        const { response, status, json } = createResponse();

        await getApplication(request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({ error: "CV not found", message: "Error retrieving application" });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 500 when the CV file path is a directory traversal attack", async () => {
        findOneCv.mockResolvedValue({ ...storedCv, filePath: "../../etc/passwd" });
        const request = createRequest<object, never, { jobDuplicateKey: string }>({ params: { jobDuplicateKey: duplicateKey } });
        const { response, status, json } = createResponse();

        await getApplication(request, response);

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({ error: "Invalid file path", message: "Error retrieving application" });
        expect(mockLaunch).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 500 when connect rejects", async () => {
        connect.mockRejectedValue(new Error("Connection failed"));
        const request = createRequest<object, never, { jobDuplicateKey: string }>({ params: { jobDuplicateKey: duplicateKey } });
        const { response, status, json } = createResponse();

        await getApplication(request, response);

        expect(status).toHaveBeenCalledWith(500);
        expect(json).toHaveBeenCalledWith({ error: "Connection failed", message: "Error retrieving application" });
        expect(close).toHaveBeenCalledTimes(1);
    });
});
