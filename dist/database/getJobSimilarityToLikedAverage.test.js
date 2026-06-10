import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const jobEmbedding = [1, 0, 0];
const connect = jest.fn();
const close = jest.fn();
const find = jest.fn();
const toArray = jest.fn();
const calculateCosineSimilarity = jest.fn();
jest.unstable_mockModule("./database.js", () => ({
    client: { connect, close },
    jobsCollection: { find },
}));
jest.unstable_mockModule("../embeddings/calculateCosineSimilarity.js", () => ({
    default: calculateCosineSimilarity,
}));
const { default: getJobSimilarityToLikedAverage } = await import("./getJobSimilarityToLikedAverage.js");
function createStoredJob(overrides = {}) {
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
describe("getJobSimilarityToLikedAverage", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        connect.mockResolvedValue();
        close.mockResolvedValue();
        toArray.mockResolvedValue([]);
        find.mockReturnValue({ toArray });
    });
    it("returns the cosine similarity of the body embedding against the average liked-jobs embedding", async () => {
        const likedEmbeddingA = [0, 1, 0];
        const likedEmbeddingB = [0, 0, 1];
        const request = createRequest(jobEmbedding);
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
        const request = createRequest(jobEmbedding);
        const { response, status, json } = createResponse();
        toArray.mockResolvedValue([]);
        await getJobSimilarityToLikedAverage(request, response);
        expect(calculateCosineSimilarity).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ similarity: null });
        expect(close).toHaveBeenCalledTimes(1);
    });
    it("returns 400 when the request body is not a non-empty array of numbers", async () => {
        const request = createRequest([1, "not-a-number", 0]);
        const { response, status, json } = createResponse();
        await getJobSimilarityToLikedAverage(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            message: "Request body must be a non-empty array of numbers",
        });
        expect(connect).not.toHaveBeenCalled();
        expect(find).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=getJobSimilarityToLikedAverage.test.js.map