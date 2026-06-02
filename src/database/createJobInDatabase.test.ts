import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { ScrapedJob } from "#types";

const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";

type InsertOneResult = {
    insertedId: string;
};

type JobsCollectionMock = {
    insertOne: ReturnType<typeof jest.fn<(jobData: ScrapedJob) => Promise<InsertOneResult>>>;
};

type DatabaseMock = {
    collection: ReturnType<typeof jest.fn<(collectionName: string) => JobsCollectionMock>>;
};

type MongoClientMock = {
    db: ReturnType<typeof jest.fn<(databaseName: string) => DatabaseMock>>;
    close: ReturnType<typeof jest.fn<() => Promise<void>>>;
};

const insertedJobId = "inserted-job-id";
const insertOne = jest.fn<(jobData: ScrapedJob) => Promise<InsertOneResult>>();
const collection = jest.fn<(collectionName: string) => JobsCollectionMock>();
const db = jest.fn<(databaseName: string) => DatabaseMock>();
const close = jest.fn<() => Promise<void>>();
const mongoClientConstructor = jest.fn<(connectionString: string) => MongoClientMock>();

jest.unstable_mockModule("mongodb", () => ({
    MongoClient: mongoClientConstructor,
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
    } satisfies ScrapedJob;
}

function createRequest(body: ScrapedJob): Request<object, object, ScrapedJob> {
    return { body } as Request<object, object, ScrapedJob>;
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
        collection.mockReturnValue({ insertOne });
        db.mockReturnValue({ collection });
        close.mockResolvedValue();
        mongoClientConstructor.mockReturnValue({ db, close });
    });

    it("inserts the ScrapedJob request body and responds with the new job id", async () => {
        const jobData = createScrapedJob();
        const request = createRequest(jobData);
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(mongoClientConstructor).toHaveBeenCalledWith(mongoDbConnectionString);
        expect(db).toHaveBeenCalledWith("jobMatch");
        expect(collection).toHaveBeenCalledWith("jobs");
        expect(insertOne).toHaveBeenCalledWith(jobData);
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Job created", jobId: insertedJobId });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("closes the MongoDB client when insertion fails", async () => {
        const insertionError = new Error("Insert failed");
        const request = createRequest(createScrapedJob());
        const { response } = createResponse();

        insertOne.mockRejectedValue(insertionError);

        await expect(createJobInDatabase(request, response)).rejects.toThrow(insertionError);

        expect(close).toHaveBeenCalledTimes(1);
    });
});