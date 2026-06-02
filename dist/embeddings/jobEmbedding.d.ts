import type { ScrapedJob, TextEmbedding } from "#types";
export declare const JOB_EMBEDDING_MODEL = "embeddinggemma";
export declare function buildJobEmbeddingInput(job: ScrapedJob): string;
export declare function createJobEmbedding(job: ScrapedJob): Promise<TextEmbedding>;
//# sourceMappingURL=jobEmbedding.d.ts.map