import { jest } from "@jest/globals";
export const segmentCoverLetter = jest.fn();
export function mockCoverLetterSegmentationModule() {
    jest.unstable_mockModule("../coverLetters/coverLetterSegmentation.js", () => ({
        segmentCoverLetter,
    }));
}
//# sourceMappingURL=coverLetterSegmentation.test.js.map