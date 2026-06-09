import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const embedMany = jest.fn();
jest.unstable_mockModule("../embeddings/embeddings.js", () => ({
    embedMany,
}));
const { createStoredCoverLetterFromTextSegments } = await import("./coverLetterEmbeddings.js");
describe("createStoredCoverLetterFromTextSegments", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        embedMany.mockResolvedValue([[0.1], [0.2], [0.3]]);
    });
    it("embeds only non-empty segments and stores null embeddings for empty segments", async () => {
        const storedCoverLetter = await createStoredCoverLetterFromTextSegments({
            subject: "",
            salutation: "Dear Hiring Manager,",
            introduction: "Intro",
            mainBody: "",
            conclusion: "Conclusion",
            greetings: "",
        });
        expect(embedMany).toHaveBeenCalledWith(["Dear Hiring Manager,", "Intro", "Conclusion"]);
        expect(storedCoverLetter).toEqual({
            subject: { text: "", embedding: null },
            salutation: { text: "Dear Hiring Manager,", embedding: [0.1] },
            introduction: { text: "Intro", embedding: [0.2] },
            mainBody: { text: "", embedding: null },
            conclusion: { text: "Conclusion", embedding: [0.3] },
            greetings: { text: "", embedding: null },
        });
    });
});
//# sourceMappingURL=coverLetterEmbeddings.test.js.map