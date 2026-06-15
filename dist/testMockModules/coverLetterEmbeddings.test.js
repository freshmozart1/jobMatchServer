import { jest } from "@jest/globals";
export const createStoredCoverLetterFromTextSegments = jest.fn();
export function mockCoverLetterEmbeddingsModule() {
    return jest.unstable_mockModule("../coverLetters/coverLetterEmbeddings.js", () => ({
        createStoredCoverLetterFromTextSegments,
    }));
}
//# sourceMappingURL=coverLetterEmbeddings.test.js.map