import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { StoredScrapedJob, TextEmbedding } from "#types";

type GetJobSimilarityToLikedAverageRequestQuery = {
    "job-id": string;
};

type FindResultMock = {
    toArray: ReturnType<typeof jest.fn<() => Promise<StoredScrapedJob[]>>>;
};

type JobsCollectionMock = {
    findOne: ReturnType<typeof jest.fn<(filter: unknown) => Promise<StoredScrapedJob | null>>>;
    find: ReturnType<typeof jest.fn<() => FindResultMock>>;
};

const validJobId = "507f1f77bcf86cd799439011";
const jobEmbedding = [1, 0, 0] satisfies TextEmbedding;
const connect = jest.fn<() => Promise<void>>();
const close = jest.fn<() => Promise<void>>();
const findOne = jest.fn<(filter: unknown) => Promise<StoredScrapedJob | null>>();
const find = jest.fn<() => FindResultMock>();
const toArray = jest.fn<() => Promise<StoredScrapedJob[]>>();
const calculateCosineSimilarity = jest.fn<(vecA: TextEmbedding, vecB: TextEmbedding) => number>();

jest.unstable_mockModule("./database.js", () => ({
    client: { connect, close },
    jobsCollection: { findOne, find } satisfies JobsCollectionMock,
}));

jest.unstable_mockModule("../embeddings/calculateCosineSimilarity.js", () => ({
    default: calculateCosineSimilarity,
}));

const { default: getJobSimilarityToLikedAverage } = await import("./getJobSimilarityToLikedAverage.js");

function createStoredJob(overrides: Partial<StoredScrapedJob> = {}): StoredScrapedJob {
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
        ...overrides,
    } satisfies StoredScrapedJob;
}

function createRequest(query: unknown): Request<object, object, object, GetJobSimilarityToLikedAverageRequestQuery> {
    return { query } as Request<object, object, object, GetJobSimilarityToLikedAverageRequestQuery>;
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

describe("getJobSimilarityToLikedAverage", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        connect.mockResolvedValue();
        close.mockResolvedValue();
        findOne.mockResolvedValue(createStoredJob());
        toArray.mockResolvedValue([]);
        find.mockReturnValue({ toArray });
    });

    it("returns the cosine similarity of the job against the average liked-jobs embedding", async () => {
        const likedEmbeddingA = [0, 1, 0] satisfies TextEmbedding;
        const likedEmbeddingB = [0, 0, 1] satisfies TextEmbedding;
        const request = createRequest({ "job-id": validJobId });
        const { response, status, json } = createResponse();

        toArray.mockResolvedValue([
            createStoredJob({ embedding: likedEmbeddingA }),
            createStoredJob({ embedding: likedEmbeddingB }),
        ]);
        calculateCosineSimilarity.mockReturnValue(0.75);

        await getJobSimilarityToLikedAverage(request, response);

        // Average of [0,1,0] and [0,0,1] is [0, 0.5, 0.5]
        expect(calculateCosineSimilarity).toHaveBeenCalledWith(jobEmbedding, [0, 0.5, 0.5]);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ similarity: 0.75 });
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns similarity: null when there are no liked jobs", async () => {
        const request = createRequest({ "job-id": validJobId });
        const { response, status, json } = createResponse();

        toArray.mockResolvedValue([]);

        await getJobSimilarityToLikedAverage(request, response);

        expect(calculateCosineSimilarity).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ similarity: null });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when the job-id query parameter is invalid", async () => {
        const request = createRequest({ "job-id": "invalid" });
        const { response, status, json } = createResponse();

        await getJobSimilarityToLikedAverage(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            message: "Query parameters must include job-id as a 24-character string",
        });
        expect(connect).not.toHaveBeenCalled();
        expect(findOne).not.toHaveBeenCalled();
    });

    it("returns 404 when the job is not found", async () => {
        const request = createRequest({ "job-id": validJobId });
        const { response, status, json } = createResponse();

        findOne.mockResolvedValue(null);

        await getJobSimilarityToLikedAverage(request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({ message: "Job not found" });
        expect(find).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });
});
