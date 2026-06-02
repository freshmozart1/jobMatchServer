import ollama from "ollama";
import type { ScrapedJob, TextEmbedding } from "#types";

export const JOB_EMBEDDING_MODEL = "embeddinggemma";

export function buildJobEmbeddingInput(job: ScrapedJob): string {
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

export async function createJobEmbedding(job: ScrapedJob): Promise<TextEmbedding> {
    const input = buildJobEmbeddingInput(job);
    const response = await ollama.embed({
        model: JOB_EMBEDDING_MODEL,
        input,
        truncate: true,
    });
    const embedding = response.embeddings[0];

    if (!embedding) {
        throw new Error("Ollama did not return a job embedding");
    }

    return embedding;
}