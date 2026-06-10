import type { Request, Response } from "express";
import { ObjectId } from "mongodb";
import type { TextEmbedding } from "#types";
import { client, jobsCollection } from "./database.js";
import calculateCosineSimilarity from "../embeddings/calculateCosineSimilarity.js";

type GetJobSimilarityToLikedAverageRequestQuery = {
    "job-id": string;
};

function isValidGetJobSimilarityToLikedAverageRequestQuery(query: unknown): query is GetJobSimilarityToLikedAverageRequestQuery {
    return typeof query === "object"
        && query !== null
        && "job-id" in query
        && typeof query["job-id"] === "string"
        && query["job-id"].trim().length === 24;
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

export default async function getJobSimilarityToLikedAverage(request: Request<object, object, object, GetJobSimilarityToLikedAverageRequestQuery>, response: Response): Promise<void> {
    if (!isValidGetJobSimilarityToLikedAverageRequestQuery(request.query)) {
        response.status(400).json({ message: "Query parameters must include job-id as a 24-character string" });
        return;
    }

    const jobId = request.query["job-id"];

    await client.connect();

    try {
        const job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });

        if (!job) {
            response.status(404).json({ message: "Job not found" });
            return;
        }

        const likedJobs = await jobsCollection.find({ like: true }).toArray();
        const averageEmbedding = calculateAverageEmbedding(likedJobs.map(j => j.embedding));

        if (!averageEmbedding) {
            response.status(200).json({ similarity: null });
            return;
        }

        const similarity = calculateCosineSimilarity(job.embedding, averageEmbedding);
        response.status(200).json({ similarity });
    } finally {
        await client.close();
    }
}
