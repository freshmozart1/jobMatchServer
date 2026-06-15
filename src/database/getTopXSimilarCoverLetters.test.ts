import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { StoredCoverLetter, StoredScrapedJob, TextEmbedding } from "#types";
import { mockMongoDbModule, connect, close, createToArray, createFind } from "../testMockModules/mongodb.test.js";
import { mockLocalDatabaseModule, getCollection } from "../testMockModules/localDatabase.test.js";
import { mockCalculateCosineSimilarityModule, calculateCosineSimilarity } from "../testMockModules/calculateCosineSimilarity.test.js";
import createResponse from "../testHelpers/createResponse.test.js";
import createRequest from "../testHelpers/createRequest.test.js";
import { createJob, duplicateKey, embedding as jobEmbedding } from "../testHelpers/createJob.test.js";

type GetTopXSimilarCoverLettersRequestQuery = {
    "job-id": string;
    x: string;
};

const validJobId = "507f1f77bcf86cd799439011";

const findOne = jest.fn<(filter: unknown) => Promise<StoredScrapedJob | null>>();
const find = createFind<StoredCoverLetter>();
const toArray = createToArray<StoredCoverLetter>();

mockMongoDbModule();
mockLocalDatabaseModule();
mockCalculateCosineSimilarityModule();

// The module under test is imported after the mocks to ensure the mocks are used
const { default: getTopXSimilarCoverLetters } = await import("./getTopXSimilarCoverLetters.js");

function createStoredCoverLetter(introductionEmbedding: TextEmbedding, mainBodyEmbedding: TextEmbedding, conclusionEmbedding: TextEmbedding, label: string): StoredCoverLetter {
    return {
        subject: { text: `Subject ${label}`, embedding: null },
        salutation: { text: "Dear Hiring Manager,", embedding: null },
        introduction: { text: `Introduction ${label}`, embedding: introductionEmbedding },
        mainBody: { text: `Main body ${label}`, embedding: mainBodyEmbedding },
        conclusion: { text: `Conclusion ${label}`, embedding: conclusionEmbedding },
        greetings: { text: "Best regards\nOle", embedding: null },
        jobDuplicateKey: duplicateKey,
    };
}

describe("getTopXSimilarCoverLetters", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        connect.mockResolvedValue();
        close.mockResolvedValue();
        getCollection.mockReturnValue({ find, findOne });
        findOne.mockResolvedValue(createJob<StoredScrapedJob>(true));
        toArray.mockResolvedValue([]);
        find.mockReturnValue({ toArray });
    });

    it("returns the top x cover letters sorted by cosine similarity", async () => {
        const firstIntroductionEmbedding = [0.1, 0.2, 0.3] satisfies TextEmbedding;
        const firstMainBodyEmbedding = [0.2, 0.3, 0.4] satisfies TextEmbedding;
        const firstConclusionEmbedding = [0.3, 0.4, 0.5] satisfies TextEmbedding;
        const secondIntroductionEmbedding = [0.4, 0.5, 0.6] satisfies TextEmbedding;
        const secondMainBodyEmbedding = [0.5, 0.6, 0.7] satisfies TextEmbedding;
        const secondConclusionEmbedding = [0.6, 0.7, 0.8] satisfies TextEmbedding;
        const thirdIntroductionEmbedding = [0.7, 0.8, 0.9] satisfies TextEmbedding;
        const thirdMainBodyEmbedding = [0.8, 0.9, 1] satisfies TextEmbedding;
        const thirdConclusionEmbedding = [0.9, 1, 1.1] satisfies TextEmbedding;
        const request = createRequest<object, GetTopXSimilarCoverLettersRequestQuery>({ query: { "job-id": validJobId, x: "2" } });
        const { response, status, json } = createResponse();

        toArray.mockResolvedValue([
            createStoredCoverLetter(firstIntroductionEmbedding, firstMainBodyEmbedding, firstConclusionEmbedding, "first"),
            createStoredCoverLetter(secondIntroductionEmbedding, secondMainBodyEmbedding, secondConclusionEmbedding, "second"),
            createStoredCoverLetter(thirdIntroductionEmbedding, thirdMainBodyEmbedding, thirdConclusionEmbedding, "third"),
        ]);

        for (const v of [0.2, 0.3, 0.4, 0.8, 0.9, 1, 0.5, 0.6, 0.7]) calculateCosineSimilarity.mockReturnValueOnce(v);

        await getTopXSimilarCoverLetters(request, response);

        const expectedEmbeddings = [
            firstIntroductionEmbedding, firstMainBodyEmbedding, firstConclusionEmbedding,
            secondIntroductionEmbedding, secondMainBodyEmbedding, secondConclusionEmbedding,
            thirdIntroductionEmbedding, thirdMainBodyEmbedding, thirdConclusionEmbedding,
        ];
        for (const [i, embedding] of expectedEmbeddings.entries()) {
            expect(calculateCosineSimilarity).toHaveBeenNthCalledWith(i + 1, jobEmbedding, embedding);
        }
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
        const request = createRequest<object, GetTopXSimilarCoverLettersRequestQuery>({ query: { "job-id": validJobId, x: "3" } });
        const { response, status, json } = createResponse();

        await getTopXSimilarCoverLetters(request, response);

        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ topXLetterResults: [] });
        expect(calculateCosineSimilarity).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns 400 when the query parameters are invalid", async () => {
        const request = createRequest<object, GetTopXSimilarCoverLettersRequestQuery>({ query: { "job-id": "invalid", x: "2" } });
        const { response, status, json } = createResponse();

        await getTopXSimilarCoverLetters(request, response);

        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({
            error: "Query parameters must include job-id and x, where job-id is a 24-character string and x is a positive number",
            message: "An error occurred while processing the request"
        });
        expect(connect).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
        expect(findOne).not.toHaveBeenCalled();
    });

    it("returns 404 when the job is not found", async () => {
        const request = createRequest<object, GetTopXSimilarCoverLettersRequestQuery>({ query: { "job-id": validJobId, x: "2" } });
        const { response, status, json } = createResponse();

        findOne.mockResolvedValue(null);

        await getTopXSimilarCoverLetters(request, response);

        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({ error: "Job not found", message: "An error occurred while processing the request" });
        expect(find).not.toHaveBeenCalled();
        expect(close).toHaveBeenCalledTimes(1);
    });
});