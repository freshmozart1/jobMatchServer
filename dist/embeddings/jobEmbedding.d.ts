import type { ScrapedJob, TextEmbedding } from "#types";
type ScrapedJobFields = Omit<ScrapedJob, "embedding">;
export declare function buildJobEmbeddingInput(job: ScrapedJobFields): string;
export declare function createJobEmbedding(job: ScrapedJobFields): Promise<TextEmbedding>;
export {};
//# sourceMappingURL=jobEmbedding.d.ts.map