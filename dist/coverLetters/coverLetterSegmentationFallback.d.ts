import type { CoverLetterTextSegments } from "#types";
export declare function isCoverLetterTextSegments(value: unknown): value is CoverLetterTextSegments;
export declare function segmentCoverLetterWithLlmFallback(normalizedCoverLetterText: string): Promise<CoverLetterTextSegments>;
//# sourceMappingURL=coverLetterSegmentationFallback.d.ts.map