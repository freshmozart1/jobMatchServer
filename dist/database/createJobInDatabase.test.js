import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
const insertedJobId = "inserted-job-id";
const insertOne = jest.fn();
const collection = jest.fn();
const db = jest.fn();
const close = jest.fn();
const mongoClientConstructor = jest.fn();
jest.unstable_mockModule("mongodb", () => ({
    MongoClient: mongoClientConstructor,
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
//# sourceMappingURL=createJobInDatabase.test.js.map