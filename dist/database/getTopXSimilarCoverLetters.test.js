import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const jobEmbedding = [1, 0, 0];
const validJobId = "507f1f77bcf86cd799439011";
const connect = jest.fn();
const close = jest.fn();
const findOne = jest.fn();
const find = jest.fn();
const toArray = jest.fn();
const calculateCosineSimilarity = jest.fn();
jest.unstable_mockModule("./database.js", () => ({
    client: { connect, close },
    jobsCollection: { findOne },
    coverLettersCollection: { find },
}));
jest.unstable_mockModule("../embeddings/calculateCosineSimilarity.js", () => ({
    default: calculateCosineSimilarity,
}));
const { default: getTopXSimilarCoverLetters } = await import("./getTopXSimilarCoverLetters.js");
function createStoredJob() {
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
    };
}
function createRequest(query) {
    return { query };
}
function createResponse() {
    const status = jest.fn();
    const json = jest.fn();
    const response = { status, json };
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
        const firstEmbedding = [0.1, 0.2, 0.3];
        const secondEmbedding = [0.4, 0.5, 0.6];
        const thirdEmbedding = [0.7, 0.8, 0.9];
        const request = createRequest({ "job-id": validJobId, x: "2" });
        const { response, status, json } = createResponse();
        toArray.mockResolvedValue([
            { coverLetterText: "first cover letter", embedding: firstEmbedding },
            { coverLetterText: "second cover letter", embedding: secondEmbedding },
            { coverLetterText: "third cover letter", embedding: thirdEmbedding },
        ]);
        calculateCosineSimilarity
            .mockReturnValueOnce(0.2)
            .mockReturnValueOnce(0.9)
            .mockReturnValueOnce(0.5);
        await getTopXSimilarCoverLetters(request, response);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(1, jobEmbedding, firstEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(2, jobEmbedding, secondEmbedding);
        expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(3, jobEmbedding, thirdEmbedding);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({
            topXLetterResults: [
                { coverLetterText: "second cover letter", similarity: 0.9 },
                { coverLetterText: "third cover letter", similarity: 0.5 },
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
//# sourceMappingURL=getTopXSimilarCoverLetters.test.js.map