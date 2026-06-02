import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
const insertedJobId = "inserted-job-id";
const embedding = [0.1, 0.2, 0.3];
const insertOne = jest.fn();
const collection = jest.fn();
const db = jest.fn();
const close = jest.fn();
const mongoClientConstructor = jest.fn();
const createJobEmbedding = jest.fn();
jest.unstable_mockModule("mongodb", () => ({
    MongoClient: mongoClientConstructor,
}));
jest.unstable_mockModule("../embeddings/jobEmbedding.js", () => ({
    createJobEmbedding,
}));
const { default: createJobInDatabase } = await import("./createJobInDatabase.js");
function createScrapedJob() {
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
    };
}
function createRequest(body) {
    return { body };
}
function createResponse() {
    const status = jest.fn();
    const json = jest.fn();
    const response = { status, json };
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
    it("does not insert when embedding creation fails", async () => {
        const embeddingError = new Error("Embedding failed");
        const request = createRequest({ job: createScrapedJob(), like: true });
        const { response } = createResponse();
        createJobEmbedding.mockRejectedValue(embeddingError);
        await expect(createJobInDatabase(request, response)).rejects.toThrow(embeddingError);
        expect(insertOne).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });
    it("returns 400 when the request body does not include a job object", async () => {
        const request = createRequest({ like: true });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
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
        expect(mongoClientConstructor).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=createJobInDatabase.test.js.map