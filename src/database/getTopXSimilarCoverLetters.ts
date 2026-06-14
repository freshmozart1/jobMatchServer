import type { Request, Response } from "express";
import { type StoredScrapedJob, type StoredCoverLetter, type TextEmbedding } from "#types";
import { MongoClient, ObjectId } from "mongodb";
import calculateCosineSimilarity from "../embeddings/calculateCosineSimilarity.js";
import { getCoverLetterTextSegments, reconstructCoverLetterText } from "../coverLetters/coverLetterSegmentation.js";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";

type GetTopXSimilarCoverLettersRequestQuery = {
    'job-id': string;
    'x': string;
};

const SEGMENT_SIMILARITY_WEIGHTS = {
    subject: 0.06,
    salutation: 0.02,
    introduction: 0.2,
    mainBody: 0.5,
    conclusion: 0.20,
    greetings: 0.02,
};

function calculateWeightedCoverLetterSimilarity(jobEmbedding: TextEmbedding, coverLetter: StoredCoverLetter): number {
    let weightedSimilaritySum = 0;
    let appliedWeightSum = 0;

    for (const [segmentName, weight] of Object.entries(SEGMENT_SIMILARITY_WEIGHTS)) {
        const embedding = coverLetter[segmentName as keyof typeof SEGMENT_SIMILARITY_WEIGHTS].embedding;

        if (!embedding) continue;

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
    if (!connectionStringConfigured(response)) return;

    const { "job-id": jobId, x } = request.query;
    const topX = Number(x);
    const client = new MongoClient(MONGODB_CONNECTION!);
    const jobNotFoundError = new Error("Job not found");
    const invalidRequestQueryError = new Error("Query parameters must include job-id and x, where job-id is a 24-character string and x is a positive number");
    
    await client.connect();

    try {
        if (!isValidGetTopXSimilarCoverLettersRequestQuery(request.query)) throw invalidRequestQueryError;

        const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne({ _id: new ObjectId(jobId) });

        if (!job) throw jobNotFoundError;

        response.status(200).json({
            topXLetterResults: (await getCollection<StoredCoverLetter>(client, 'coverLetters').find().toArray()).map(cl => (
                {
                    coverLetterText: reconstructCoverLetterText(getCoverLetterTextSegments(cl)),
                    similarity: calculateWeightedCoverLetterSimilarity(job.embedding, cl),
                }
            )).sort((first, second) => second.similarity - first.similarity).slice(0, topX)
        });
    } catch (error) {
        const isJobNotFoundError = error instanceof Error && error.message === jobNotFoundError.message;
        const isInvalidRequestQueryError = error instanceof Error && error.message === invalidRequestQueryError.message;
        createErrorMessage(
            response,
            error,
            "An error occurred while processing the request",
            isJobNotFoundError
                ? 404
                : isInvalidRequestQueryError
                    ? 400
                    : 500
        );
    }
    finally {
        await client.close();
    }
}
