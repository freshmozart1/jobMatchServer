import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { CreateJobInDatabaseRequestBody, ScrapedJob, StoredScrapedJob, TextEmbedding } from "#types";

const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";

type InsertOneResult = {
    insertedId: string;
};

type JobsCollectionMock = {
    insertOne: ReturnType<typeof jest.fn<(jobData: StoredScrapedJob) => Promise<InsertOneResult>>>;
};

type DatabaseMock = {
    collection: ReturnType<typeof jest.fn<(collectionName: string) => JobsCollectionMock>>;
};

type MongoClientMock = {
    db: ReturnType<typeof jest.fn<(databaseName: string) => DatabaseMock>>;
    close: ReturnType<typeof jest.fn<() => Promise<void>>>;
};

const insertedJobId = "inserted-job-id";
const embedding = [0.1, 0.2, 0.3] satisfies TextEmbedding;
const insertOne = jest.fn<(jobData: StoredScrapedJob) => Promise<InsertOneResult>>();
const collection = jest.fn<(collectionName: string) => JobsCollectionMock>();
const db = jest.fn<(databaseName: string) => DatabaseMock>();
const close = jest.fn<() => Promise<void>>();
const mongoClientConstructor = jest.fn<(connectionString: string) => MongoClientMock>();
const createJobEmbedding = jest.fn<(job: ScrapedJob) => Promise<TextEmbedding>>();
const isOllamaAvailable = jest.fn<() => Promise<boolean>>();

jest.unstable_mockModule("mongodb", () => ({
    MongoClient: mongoClientConstructor,
}));

jest.unstable_mockModule("../embeddings/jobEmbedding.js", () => ({
    createJobEmbedding,
}));

jest.unstable_mockModule("../ollama/ollamaServer.js", () => ({
    isOllamaAvailable,
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
        collection.mockReturnValue({ insertOne });
        db.mockReturnValue({ collection });
        close.mockResolvedValue();
        mongoClientConstructor.mockReturnValue({ db, close });
        createJobEmbedding.mockResolvedValue(embedding);
        isOllamaAvailable.mockResolvedValue(true);
    });

    it("embeds the ScrapedJob request body, stores the flattened job, and responds with the new job id", async () => {
        const job = createScrapedJob();
        const like = true;
        const request = createRequest({ job, like });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(mongoClientConstructor).toHaveBeenCalledWith(mongoDbConnectionString);
        expect(db).toHaveBeenCalledWith("jobMatch");
        expect(collection).toHaveBeenCalledWith("jobs");
        expect(createJobEmbedding).toHaveBeenCalledWith(job);
        expect(insertOne).toHaveBeenCalledWith({ ...job, like, embedding });
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Job created", jobId: insertedJobId });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("closes the MongoDB client when insertion fails", async () => {
        const insertionError = new Error("Insert failed");
        const request = createRequest({ job: createScrapedJob(), like: false });
        const { response } = createResponse();

        insertOne.mockRejectedValue(insertionError);

        await expect(createJobInDatabase(request, response)).rejects.toThrow(insertionError);

        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 503 and does not insert when Ollama is unavailable", async () => {
        const request = createRequest({ job: createScrapedJob(), like: true });
        const { response, status, json } = createResponse();

        isOllamaAvailable.mockResolvedValue(false);

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(503);
        expect(json).toHaveBeenCalledWith({ message: "Ollama not available" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(mongoClientConstructor).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
    });

    it("returns 503 and does not insert when embedding creation fails", async () => {
        const embeddingError = new Error("Embedding failed");
        const request = createRequest({ job: createScrapedJob(), like: true });
        const { response, status, json } = createResponse();

        createJobEmbedding.mockRejectedValue(embeddingError);

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(503);
        expect(json).toHaveBeenCalledWith({ message: "Ollama not available" });
        expect(insertOne).not.toHaveBeenCalled();
        expect(mongoClientConstructor).not.toHaveBeenCalled();
    });

    it("returns 400 when the request body does not include a job object", async () => {
        const request = createRequest({ like: true });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(isOllamaAvailable).not.toHaveBeenCalled();
        expect(mongoClientConstructor).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
    });

    it("returns 400 when like is not a boolean", async () => {
        const request = createRequest({ job: createScrapedJob(), like: "true" });
        const { response, status, json } = createResponse();

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(isOllamaAvailable).not.toHaveBeenCalled();
        expect(mongoClientConstructor).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
    });

    it("returns 400 before checking Ollama when the body is invalid", async () => {
        const request = createRequest(null);
        const { response, status, json } = createResponse();

        isOllamaAvailable.mockResolvedValue(false);

        await createJobInDatabase(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(isOllamaAvailable).not.toHaveBeenCalled();
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(mongoClientConstructor).not.toHaveBeenCalled();
    });
});