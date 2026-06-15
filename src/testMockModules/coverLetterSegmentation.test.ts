import { jest } from "@jest/globals";
import type { CoverLetterTextSegments } from "#types";

export const segmentCoverLetter = jest.fn<(input: string) => Promise<{ segments: CoverLetterTextSegments }>>();

export function mockCoverLetterSegmentationModule() {
    jest.unstable_mockModule("../coverLetters/coverLetterSegmentation.js", () => ({
        segmentCoverLetter,
    }));
}