import type { TextEmbedding } from "#types";
import { OpenAI } from "openai";

const EMBEDDING_MODEL = "text-embedding-3-small";

export async function embedMany(inputs: string[]): Promise<TextEmbedding[]> {
    const client = new OpenAI();
    const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
    });
    const embeddings = response.data.map((embeddingResponse) => embeddingResponse.embedding);

    if (embeddings.length !== inputs.length || embeddings.some((embedding) => !embedding)) {
        throw new Error("OpenAI did not return an embedding");
    }

    return embeddings;
}

export async function embed(input: string): Promise<TextEmbedding> {
    const [embedding] = await embedMany([input]);

    if (!embedding) {
        throw new Error("OpenAI did not return an embedding");
    }

    return embedding;
}