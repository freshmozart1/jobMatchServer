import type { Request, Response } from "express";
import type { TextEmbedding } from "#types";
import { client, jobsCollection } from "./database.js";
import calculateCosineSimilarity from "../embeddings/calculateCosineSimilarity.js";

function isValidTextEmbeddingBody(body: unknown): body is TextEmbedding {
    return Array.isArray(body)
        && body.length > 0
        && body.every(value => typeof value === "number");
}

function calculateAverageEmbedding(embeddings: TextEmbedding[]): TextEmbedding | null {
    const first = embeddings[0];
    if (!first) return null;
    const dimension = first.length;
    const sum: number[] = new Array<number>(dimension).fill(0);
    for (const embedding of embeddings) {
        for (let i = 0; i < dimension; i++) {
            const s = sum[i];
            const e = embedding[i];
            if (typeof s === "number" && typeof e === "number") {
                sum[i] = s + e;
            }
        }
    }
    return sum.map(v => v / embeddings.length);
}

export default async function getJobSimilarityToLikedAverage(request: Request<object, object, TextEmbedding>, response: Response): Promise<void> {
    if (!isValidTextEmbeddingBody(request.body)) {
        response.status(400).json({ message: "Request body must be a non-empty array of numbers" });
        return;
    }

    const embedding = request.body;

    await client.connect();

    try {
        const likedJobs = await jobsCollection.find({ like: true }).toArray();
        const averageEmbedding = calculateAverageEmbedding(likedJobs.map(j => j.embedding));

        if (!averageEmbedding) {
            response.status(200).json({ similarity: null });
            return;
        }

        const similarity = calculateCosineSimilarity(embedding, averageEmbedding);
        response.status(200).json({ similarity });
    } finally {
        await client.close();
    }
}
