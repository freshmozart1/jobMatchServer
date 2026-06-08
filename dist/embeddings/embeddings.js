import { OpenAI } from "openai";
const EMBEDDING_MODEL = "text-embedding-3-small";
export async function embed(input) {
    const client = new OpenAI();
    const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding) {
        throw new Error("OpenAI did not return an embedding");
    }
    return embedding;
}
//# sourceMappingURL=embeddings.js.map