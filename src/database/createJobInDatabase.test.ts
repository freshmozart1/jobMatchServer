import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { CreateJobInDatabaseRequestBody, ScrapedJob, StoredScrapedJob, TextEmbedding } from "#types";

type InsertOneResult = {
    insertedId: string;
};

type JobsCollectionMock = {
    insertOne: ReturnType<typeof jest.fn<(jobData: StoredScrapedJob) => Promise<InsertOneResult>>>;
};

const insertedJobId = "inserted-job-id";
const embedding = [0.1, 0.2, 0.3] satisfies TextEmbedding;
const insertOne = jest.fn<(jobData: StoredScrapedJob) => Promise<InsertOneResult>>();
const connect = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("./database.js", () => ({
    client: { connect },
    jobsCollection: { insertOne } satisfies JobsCollectionMock,
}));

const { default: createJobInDatabase } = await import("./createJobInDatabase.js");

function createScrapedJob(): ScrapedJob {
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
        embedding,
    } satisfies ScrapedJob;
}

function createRequest(body: unknown): Request<object, object, CreateJobInDatabaseRequestBody> {
    return { body } as Request<object, object, CreateJobInDatabaseRequestBody>;
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

describe("createJobInDatabase", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        insertOne.mockResolvedValue({ insertedId: insertedJobId });
        connect.mockResolvedValue();
    });

    it("stores the flattened job and responds with the new job id", async () => {
        const job = createScrapedJob();
        const like = true;
        const request = createRequest({ job, like });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(insertOne).toHaveBeenCalledWith({ ...job, like });
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Job created", jobId: insertedJobId });
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it("keeps the MongoDB client open when insertion fails", async () => {
        const insertionError = new Error("Insert failed");
        const request = createRequest({ job: createScrapedJob(), like: false });
        const { response } = createResponse();

        insertOne.mockRejectedValue(insertionError);

        await expect(createJobInDatabase(request, response)).rejects.toThrow(insertionError);

        expect(connect).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when the request body does not include a job object", async () => {
        const request = createRequest({ like: true });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });

    it("returns 400 when like is not a boolean", async () => {
        const request = createRequest({ job: createScrapedJob(), like: "true" });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
});
