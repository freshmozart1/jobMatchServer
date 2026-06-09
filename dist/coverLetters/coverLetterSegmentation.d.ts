import type { CoverLetterTextSegments, StoredCoverLetter } from "#types";
export declare const COVER_LETTER_SEGMENT_NAMES: readonly ["subject", "salutation", "introduction", "mainBody", "conclusion", "greetings"];
export type CoverLetterSegmentationSource = "heuristic" | "llm";
export type CoverLetterSegmentationResult = {
    segments: CoverLetterTextSegments;
    source: CoverLetterSegmentationSource;
    confidence: number;
    fallbackReason?: string;
};
type HeuristicSegmentationResult = {
    segments: CoverLetterTextSegments;
    confidence: number;
    fallbackReason?: string;
};
export declare function segmentCoverLetterHeuristically(input: string): HeuristicSegmentationResult;
export declare function segmentCoverLetter(input: string): Promise<CoverLetterSegmentationResult>;
export declare function reconstructCoverLetterText(segments: CoverLetterTextSegments): string;
export declare function getCoverLetterTextSegments(coverLetter: StoredCoverLetter): CoverLetterTextSegments;
export {};
//# sourceMappingURL=coverLetterSegmentation.d.ts.map