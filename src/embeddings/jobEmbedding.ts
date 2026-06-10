import type { ScrapedJob, TextEmbedding } from "#types";
import { embed } from "./embeddings.js";

type ScrapedJobFields = Omit<ScrapedJob, "embedding">;

export function buildJobEmbeddingInput(job: ScrapedJobFields): string {
    const fields = [
        ["Title", job.title],
        ["Company", job.company],
        ["Location", job.location],
        ["Description", job.descriptionText],
        ["Posted At", job.postedAt],
        ["Source Hostname", job.sourceHostname],
        ["Source URL", job.sourceUrl],
        ["Tags", job.tags?.join(", ")],
    ];

    return fields
        .filter((field): field is [string, string] => typeof field[1] === "string" && field[1].trim().length > 0)
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n")
        .replace(/\s+/g, " ")
        .trim();
}

export async function createJobEmbedding(job: ScrapedJobFields): Promise<TextEmbedding> {
    return embed(buildJobEmbeddingInput(job));
}