import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { StoredCoverLetter, StoredScrapedJob, TextEmbedding } from "#types";

type GetTopXSimilarCoverLettersRequestQuery = {
    "job-id": string;
    x: string;
};

type FindResultMock = {
    toArray: ReturnType<typeof jest.fn<() => Promise<StoredCoverLetter[]>>>;
};

type JobsCollectionMock = {
    findOne: ReturnType<typeof jest.fn<(filter: unknown) => Promise<StoredScrapedJob | null>>>;
};

type CoverLettersCollectionMock = {
    find: ReturnType<typeof jest.fn<() => FindResultMock>>;
};

const jobEmbedding = [1, 0, 0] satisfies TextEmbedding;
const validJobId = "507f1f77bcf86cd799439011";
const connect = jest.fn<() => Promise<void>>();
const close = jest.fn<() => Promise<void>>();
const findOne = jest.fn<(filter: unknown) => Promise<StoredScrapedJob | null>>();
const find = jest.fn<() => FindResultMock>();
const toArray = jest.fn<() => Promise<StoredCoverLetter[]>>();
const calculateCosineSimilarity = jest.fn<(vecA: TextEmbedding, vecB: TextEmbedding) => number>();

jest.unstable_mockModule("./database.js", () => ({
    client: { connect, close },
    jobsCollection: { findOne } satisfies JobsCollectionMock,
    coverLettersCollection: { find } satisfies CoverLettersCollectionMock,
}));

jest.unstable_mockModule("../embeddings/calculateCosineSimilarity.js", () => ({
    default: calculateCosineSimilarity,
}));

const { default: getTopXSimilarCoverLetters } = await import("./getTopXSimilarCoverLetters.js");

function createStoredJob(): StoredScrapedJob {
    return {
        sourceHostname: "www.linkedin.com",
        sourceJobId: "123456789",
        sourceUrl: "https://www.linkedin.com/jobs/view/123456789",
        title: "Software Engineer",
        company: "Example Company",
        location: "Remote",
        descriptionText: "Build and maintain TypeScript services.",
        postedAt: "2026-06-01",
        scrapedAt: "2026-06-02T00:00:00.000Z",
        tags: ["typescript", "node"],
        duplicateKey: "linkedin:123456789",
        like: true,
        embedding: jobEmbedding,
    } satisfies StoredScrapedJob;
}

function createStoredCoverLetter(introductionEmbedding: TextEmbedding, mainBodyEmbedding: TextEmbedding, conclusionEmbedding: TextEmbedding, label: string): StoredCoverLetter {
    return {
        subject: { text: `Subject ${label}`, embedding: null },
        salutation: { text: "Dear Hiring Manager,", embedding: null },
        introduction: { text: `Introduction ${label}`, embedding: introductionEmbedding },
        mainBody: { text: `Main body ${label}`, embedding: mainBodyEmbedding },
        conclusion: { text: `Conclusion ${label}`, embedding: conclusionEmbedding },
        greetings: { text: "Best regards\nOle", embedding: null },
    };
}

function createRequest(query: unknown): Request<object, object, object, GetTopXSimilarCoverLettersRequestQuery> {
    return { query } as Request<object, object, object, GetTopXSimilarCoverLettersRequestQuery>;
}

function createResponse(): {
    response: Response;
    status: ReturnType<typeof jest.fn<(statusCode: number) => Response>>;
    json: ReturnType<typeof jest.fn<(body: unknown) => Response>>;
} {
    const status = jest.fn<(statusCode: number) => Response>();
    const json = jest.fn<(body: unknown) => Response>();
    const response = { status, json } as unknown as Response;

    status.mockReturnValue(response);
    json.mockReturnValue(response);

    return { response, status, json };
}

describe("getTopXSimilarCoverLetters", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        connect.mockResolvedValue();
        close.mockResolvedValue();
        findOne.mockResolvedValue(createStoredJob());
        toArray.mockResolvedValue([]);
        find.mockReturnValue({ toArray });
    });

    it("returns the top x cover letters sorted by cosine similarity", async () => {
        const firstIntroductionEmbedding = [0.1, 0.2, 0.3] satisfies TextEmbedding;
        const firstMainBodyEmbedding = [0.2, 0.3, 0.4] satisfies TextEmbedding;
        const firstConclusionEmbedding = [0.3, 0.4, 0.5] satisfies TextEmbedding;
        const secondIntroductionEmbedding = [0.4, 0.5, 0.6] satisfies TextEmbedding;
        const secondMainBodyEmbedding = [0.5, 0.6, 0.7] satisfies TextEmbedding;
        const secondConclusionEmbedding = [0.6, 0.7, 0.8] satisfies TextEmbedding;
        const thirdIntroductionEmbedding = [0.7, 0.8, 0.9] satisfies TextEmbedding;
        const thirdMainBodyEmbedding = [0.8, 0.9, 1] satisfies TextEmbedding;
        const thirdConclusionEmbedding = [0.9, 1, 1.1] satisfies TextEmbedding;
        const request = createRequest({ "job-id": validJobId, x: "2" });
        const { response, status, json } = createResponse();

        toArray.mockResolvedValue([
            createStoredCoverLetter(firstIntroductionEmbedding, firstMainBodyEmbedding, firstConclusionEmbedding, "first"),
            createStoredCoverLetter(secondIntroductionEmbedding, secondMainBodyEmbedding, secondConclusionEmbedding, "second"),
            createStoredCoverLetter(thirdIntroductionEmbedding, thirdMainBodyEmbedding, thirdConclusionEmbedding, "third"),
        ]);
        calculateCosineSimilarity
            .mockReturnValueOnce(0.2)
            .mockReturnValueOnce(0.3)
            .mockReturnValueOnce(0.4)
            .mockReturnValueOnce(0.8)
            .mockReturnValueOnce(0.9)
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(0.5)
            .mockReturnValueOnce(0.6)
            .mockReturnValueOnce(0.7);

        await getTopXSimilarCoverLetters(request, response);

        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(1, jobEmbedding, firstIntroductionEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(2, jobEmbedding, firstMainBodyEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(3, jobEmbedding, firstConclusionEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(4, jobEmbedding, secondIntroductionEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(5, jobEmbedding, secondMainBodyEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(6, jobEmbedding, secondConclusionEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(7, jobEmbedding, thirdIntroductionEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(8, jobEmbedding, thirdMainBodyEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(9, jobEmbedding, thirdConclusionEmbedding);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({
            topXLetterResults: [
                { coverLetterText: "Subject second\n\nDear Hiring Manager,\n\nIntroduction second\n\nMain body second\n\nConclusion second\n\nBest regards\nOle", similarity: 0.9 },
                { coverLetterText: "Subject third\n\nDear Hiring Manager,\n\nIntroduction third\n\nMain body third\n\nConclusion third\n\nBest regards\nOle", similarity: 0.6 },
            ],
        });
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns an empty result when no cover letters exist", async () => {
        const request = createRequest({ "job-id": validJobId, x: "3" });
        const { response, status, json } = createResponse();

        await getTopXSimilarCoverLetters(request, response);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ topXLetterResults: [] });
        expect(calculateCosineSimilarity).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when the query parameters are invalid", async () => {
        const request = createRequest({ "job-id": "invalid", x: "2" });
        const { response, status, json } = createResponse();

        await getTopXSimilarCoverLetters(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            message: "Query parameters must include job-id and x, where job-id is a 24-character string and x is a positive number",
        });
        expect(connect).not.toHaveBeenCalled();
        expect(findOne).not.toHaveBeenCalled();
    });

    it("returns 404 when the job is not found", async () => {
        const request = createRequest({ "job-id": validJobId, x: "2" });
        const { response, status, json } = createResponse();

        findOne.mockResolvedValue(null);

        await getTopXSimilarCoverLetters(request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({ message: "Job not found" });
        expect(find).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });
});