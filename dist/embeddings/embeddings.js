import ollama from "ollama";
const EMBEDDING_MODEL = "embeddinggemma";
export async function embed(input) {
    const response = await ollama.embed({
        model: EMBEDDING_MODEL,
        input,
        truncate: true,
    });
    const embedding = response.embeddings[0];
    if (!embedding) {
        throw new Error("Ollama did not return an embedding");
    }
    return embedding;
}
//# sourceMappingURL=embeddings.js.map