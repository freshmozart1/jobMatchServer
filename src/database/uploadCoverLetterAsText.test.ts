import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request } from "express";
import type { CoverLetterTextSegments, StoredCoverLetter, CoverLetterAsTextRequestBody } from "#types";
import { mockLocalDatabaseModule, getCollection } from "../testMockModules/localDatabase.test.js";
import { mockMongoDbModule, connect } from "../testMockModules/mongodb.test.js";
import { mockCoverLetterSegmentationModule, segmentCoverLetter } from "../testMockModules/coverLetterSegmentation.test.js";
import { mockCoverLetterEmbeddingsModule, createStoredCoverLetterFromTextSegments } from "../testMockModules/coverLetterEmbeddings.test.js";
import createResponse from "../testHelpers/createResponse.test.js";

type InsertOneResult = {
    insertedId: string;
};

type FindOneAndReplaceOptions = {
    upsert: boolean;
    returnDocument: string;
};

const insertedCoverLetterId = "inserted-cover-letter-id";
const upsertedCoverLetterId = "upserted-cover-letter-id";
const insertOne = jest.fn<(coverLetter: StoredCoverLetter) => Promise<InsertOneResult>>();
const findOneAndReplace = jest.fn<(filter: { jobDuplicateKey: string }, replacement: StoredCoverLetter, options: FindOneAndReplaceOptions) => Promise<{ _id: string } | null>>();

const segments = {
    subject: "Subject: Application",
    salutation: "Dear Hiring Manager,",
    introduction: "I am excited to apply.",
    mainBody: "I build software.",
    conclusion: "I look forward to speaking with you.",
    greetings: "Best regards\nOle",
} satisfies CoverLetterTextSegments;

const storedCoverLetter = {
    subject: { text: segments.subject, embedding: [0.1] },
    salutation: { text: segments.salutation, embedding: [0.2] },
    introduction: { text: segments.introduction, embedding: [0.3] },
    mainBody: { text: segments.mainBody, embedding: [0.4] },
    conclusion: { text: segments.conclusion, embedding: [0.5] },
    greetings: { text: segments.greetings, embedding: [0.6] },
    jobDuplicateKey: "test-key-1",
} satisfies StoredCoverLetter;

const invalidRequestBodyError = { error: "Invalid request body. Please provide a non-empty coverLetterText string and a non-empty jobDuplicateKey string.", message: "An error occurred while uploading the cover letter" };

mockMongoDbModule();
mockLocalDatabaseModule();
mockCoverLetterSegmentationModule();
mockCoverLetterEmbeddingsModule();

// The module under test is imported after the mocks to ensure the mocks are used
const { default: uploadCoverLetterAsText } = await import("./uploadCoverLetterAsText.js");

function createRequest(body: unknown): Request<object, object, CoverLetterAsTextRequestBody> {
    return { body } as Request<object, object, CoverLetterAsTextRequestBody>;
}

describe("uploadCoverLetterAsText", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        connect.mockResolvedValue();
        insertOne.mockResolvedValue({ insertedId: insertedCoverLetterId });
        findOneAndReplace.mockResolvedValue({ _id: upsertedCoverLetterId });
        segmentCoverLetter.mockResolvedValue({ segments });
        createStoredCoverLetterFromTextSegments.mockResolvedValue(storedCoverLetter);
        getCollection.mockReturnValue({ insertOne, findOneAndReplace });
    });

    it("segments, embeds, stores the cover letter, and responds with the inserted id", async () => {
        const coverLetterText = "Dear Hiring Manager,\n\nI am excited to apply.\n\nBest regards\nOle";
        const request = createRequest({ coverLetterText });
        const { response, status, json } = createResponse();

        await uploadCoverLetterAsText(request, response);

        expect(segmentCoverLetter).toHaveBeenCalledWith(coverLetterText);
        expect(createStoredCoverLetterFromTextSegments).toHaveBeenCalledWith(segments);
        expect(insertOne).toHaveBeenCalledWith(storedCoverLetter);
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Cover letter uploaded", coverLetterId: insertedCoverLetterId });
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it("upserts the cover letter by jobDuplicateKey when provided", async () => {
        const coverLetterText = "Dear Hiring Manager,\n\nI am excited to apply.\n\nBest regards\nOle";
        const jobDuplicateKey = "job-key-1";
        const request = createRequest({ coverLetterText, jobDuplicateKey });
        const { response, status, json } = createResponse();

        await uploadCoverLetterAsText(request, response);

        expect(segmentCoverLetter).toHaveBeenCalledWith(coverLetterText);
        expect(createStoredCoverLetterFromTextSegments).toHaveBeenCalledWith(segments);
        expect(findOneAndReplace).toHaveBeenCalledWith(
            { jobDuplicateKey },
            { ...storedCoverLetter, jobDuplicateKey },
            { upsert: true, returnDocument: "after" },
        );
        expect(insertOne).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Cover letter uploaded", coverLetterId: upsertedCoverLetterId });
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when jobDuplicateKey is present but empty", async () => {
        const request = createRequest({ coverLetterText: "valid cover letter", jobDuplicateKey: "   " });
        const { response, status, json } = createResponse();

        await uploadCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(segmentCoverLetter).not.toHaveBeenCalled();
        expect(createStoredCoverLetterFromTextSegments).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });

    it("returns 400 when the request body is invalid", async () => {
        const request = createRequest({ coverLetterText: "   " });
        const { response, status, json } = createResponse();

        await uploadCoverLetterAsText(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(segmentCoverLetter).not.toHaveBeenCalled();
        expect(createStoredCoverLetterFromTextSegments).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
});