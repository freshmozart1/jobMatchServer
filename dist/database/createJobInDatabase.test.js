import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const insertedJobId = "inserted-job-id";
const embedding = [0.1, 0.2, 0.3];
const insertOne = jest.fn();
const connect = jest.fn();
const createJobEmbedding = jest.fn();
const isOllamaAvailable = jest.fn();
jest.unstable_mockModule("./database.js", () => ({
    client: { connect },
    jobsCollection: { insertOne },
}));
jest.unstable_mockModule("../embeddings/jobEmbedding.js", () => ({
    createJobEmbedding,
}));
jest.unstable_mockModule("../ollama/ollamaServer.js", () => ({
    isOllamaAvailable,
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
        connect.mockResolvedValue();
        createJobEmbedding.mockResolvedValue(embedding);
        isOllamaAvailable.mockResolvedValue(true);
    });
    it("embeds the ScrapedJob request body, stores the flattened job, and responds with the new job id", async () => {
        const job = createScrapedJob();
        const like = true;
        const request = createRequest({ job, like });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(createJobEmbedding).toHaveBeenCalledWith(job);
        expect(insertOne).toHaveBeenCalledWith({ ...job, like, embedding });
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
    it("returns 503 and does not insert when Ollama is unavailable", async () => {
        const request = createRequest({ job: createScrapedJob(), like: true });
        const { response, status, json } = createResponse();
        isOllamaAvailable.mockResolvedValue(false);
        await createJobInDatabase(request, response);
        expect(status).toHaveBeenCalledWith(503);
        expect(json).toHaveBeenCalledWith({ message: "Ollama not available" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
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
        expect(connect).not.toHaveBeenCalled();
    });
    it("returns 400 when the request body does not include a job object", async () => {
        const request = createRequest({ like: true });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(isOllamaAvailable).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
    it("returns 400 when like is not a boolean", async () => {
        const request = createRequest({ job: createScrapedJob(), like: "true" });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include job and boolean like fields" });
        expect(createJobEmbedding).not.toHaveBeenCalled();
        expect(isOllamaAvailable).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
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
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=createJobInDatabase.test.js.map