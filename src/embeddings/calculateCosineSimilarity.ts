import type { TextEmbedding } from "#types";

export default function calculateCosineSimilarity(vecA: TextEmbedding, vecB: TextEmbedding): number {
    if (vecA.length !== vecB.length) {
        throw new Error('Embedding vectors must have the same dimension');
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i += 1) {
        const av = vecA[i];
        const bv = vecB[i];
        if (typeof av !== "number" || typeof bv !== "number") {
            throw new Error('Embedding vectors must be arrays of numbers');
        }
        dot += av * bv;
        normA += av * av;
        normB += bv * bv;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}