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
function createStoredCoverLetter(introductionEmbedding, mainBodyEmbedding, conclusionEmbedding, label) {
    return {
        subject: { text: `Subject ${label}`, embedding: null },
        salutation: { text: "Dear Hiring Manager,", embedding: null },
        introduction: { text: `Introduction ${label}`, embedding: introductionEmbedding },
        mainBody: { text: `Main body ${label}`, embedding: mainBodyEmbedding },
        conclusion: { text: `Conclusion ${label}`, embedding: conclusionEmbedding },
        greetings: { text: "Best regards\nOle", embedding: null },
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
        const firstIntroductionEmbedding = [0.1, 0.2, 0.3];
        const firstMainBodyEmbedding = [0.2, 0.3, 0.4];
        const firstConclusionEmbedding = [0.3, 0.4, 0.5];
        const secondIntroductionEmbedding = [0.4, 0.5, 0.6];
        const secondMainBodyEmbedding = [0.5, 0.6, 0.7];
        const secondConclusionEmbedding = [0.6, 0.7, 0.8];
        const thirdIntroductionEmbedding = [0.7, 0.8, 0.9];
        const thirdMainBodyEmbedding = [0.8, 0.9, 1];
        const thirdConclusionEmbedding = [0.9, 1, 1.1];
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
                { coverLetterText: "Subject second\n\nDear Hiring Manager,\n\nIntroduction second\n\nMain body second\n\nConclusion second\n\nBest regards\nOle", similarity: expect.closeTo(0.9, 10) },
                { coverLetterText: "Subject third\n\nDear Hiring Manager,\n\nIntroduction third\n\nMain body third\n\nConclusion third\n\nBest regards\nOle", similarity: expect.closeTo(0.6, 10) },
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