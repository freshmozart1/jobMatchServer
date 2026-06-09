import type { Request, Response } from "express";
import type { StoredCoverLetter, TextEmbedding } from "#types";
import { client, jobsCollection, coverLettersCollection } from "./database.js";
import { ObjectId } from "mongodb";
import calculateCosineSimilarity from "../embeddings/calculateCosineSimilarity.js";
import { getCoverLetterTextSegments, reconstructCoverLetterText } from "../coverLetters/coverLetterSegmentation.js";

type GetTopXSimilarCoverLettersRequestQuery = {
    'job-id': string;
    'x': string;
};

type TopXLetterResult = {
    coverLetterText: string;
    similarity: number;
};

const SEGMENT_SIMILARITY_WEIGHTS = {
    subject: 0.06,
    salutation: 0.02,
    introduction: 0.2,
    mainBody: 0.5,
    conclusion: 0.20,
    greetings: 0.02,
} as const;

function calculateWeightedCoverLetterSimilarity(jobEmbedding: TextEmbedding, coverLetter: StoredCoverLetter): number {
    let weightedSimilaritySum = 0;
    let appliedWeightSum = 0;

    for (const [segmentName, weight] of Object.entries(SEGMENT_SIMILARITY_WEIGHTS)) {
        const embedding = coverLetter[segmentName as keyof typeof SEGMENT_SIMILARITY_WEIGHTS].embedding;

        if (!embedding) {
            continue;
        }

        weightedSimilaritySum += calculateCosineSimilarity(jobEmbedding, embedding) * weight;
        appliedWeightSum += weight;
    }

    return appliedWeightSum === 0 ? 0 : weightedSimilaritySum / appliedWeightSum;
}

function isValidGetTopXSimilarCoverLettersRequestQuery(query: unknown): query is GetTopXSimilarCoverLettersRequestQuery {
    return typeof query === "object"
        && query !== null
        && "job-id" in query
        && typeof query["job-id"] === "string"
        && query["job-id"].trim().length === 24
        && "x" in query
        && typeof query.x === "string"
        && !isNaN(Number(query.x))
        && Number(query.x) > 0;
}

export default async function getTopXSimilarCoverLetters(request: Request<object, object, object, GetTopXSimilarCoverLettersRequestQuery>, response: Response): Promise<void> {
    if (!isValidGetTopXSimilarCoverLettersRequestQuery(request.query)) {
        response.status(400).json({ message: "Query parameters must include job-id and x, where job-id is a 24-character string and x is a positive number" });
        return;
    }

    const { "job-id": jobId, x } = request.query;
    const topX = Number(x);

    await client.connect();

    try {
        const job = await jobsCollection.findOne({ _id: new ObjectId(jobId) });

        if (!job) {
            response.status(404).json({ message: "Job not found" });
            return;
        }

        const coverLetters = await coverLettersCollection.find().toArray();
        const topXLetterResults: TopXLetterResult[] = coverLetters
            .map((coverLetter) => ({
                coverLetterText: reconstructCoverLetterText(getCoverLetterTextSegments(coverLetter)),
                similarity: calculateWeightedCoverLetterSimilarity(job.embedding, coverLetter),
            }))
            .sort((firstLetter, secondLetter) => secondLetter.similarity - firstLetter.similarity)
            .slice(0, topX);

        response.status(200).json({ topXLetterResults });
    } finally {
        await client.close();
    }
}
