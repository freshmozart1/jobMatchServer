import ollama from "ollama";
export const JOB_EMBEDDING_MODEL = "embeddinggemma";
export function buildJobEmbeddingInput(job) {
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
        .filter((field) => typeof field[1] === "string" && field[1].trim().length > 0)
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n")
        .replace(/\s+/g, " ")
        .trim();
}
export async function createJobEmbedding(job) {
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
//# sourceMappingURL=jobEmbedding.js.map