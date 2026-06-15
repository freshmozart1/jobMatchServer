import {} from "#types";
import { MongoClient, ObjectId } from "mongodb";
import calculateCosineSimilarity from "../embeddings/calculateCosineSimilarity.js";
import { getCoverLetterTextSegments, reconstructCoverLetterText } from "../coverLetters/coverLetterSegmentation.js";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";
const SEGMENT_SIMILARITY_WEIGHTS = {
    subject: 0.06,
    salutation: 0.02,
    introduction: 0.2,
    mainBody: 0.5,
    conclusion: 0.20,
    greetings: 0.02,
};
function calculateWeightedCoverLetterSimilarity(jobEmbedding, coverLetter) {
    let weightedSimilaritySum = 0;
    let appliedWeightSum = 0;
    for (const [segmentName, weight] of Object.entries(SEGMENT_SIMILARITY_WEIGHTS)) {
        const embedding = coverLetter[segmentName].embedding;
        if (!embedding)
            continue;
        weightedSimilaritySum += calculateCosineSimilarity(jobEmbedding, embedding) * weight;
        appliedWeightSum += weight;
    }
    return appliedWeightSum === 0 ? 0 : weightedSimilaritySum / appliedWeightSum;
}
function isValidGetTopXSimilarCoverLettersRequestQuery(query) {
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
export default async function getTopXSimilarCoverLetters(request, response) {
    if (!connectionStringConfigured(response))
        return;
    const { "job-id": jobId, x } = request.query;
    const topX = Number(x);
    const jobNotFoundError = new Error("Job not found");
    const invalidRequestQueryError = new Error("Query parameters must include job-id and x, where job-id is a 24-character string and x is a positive number");
    if (!isValidGetTopXSimilarCoverLettersRequestQuery(request.query)) {
        createErrorMessage(response, invalidRequestQueryError, "An error occurred while processing the request", 400);
        return;
    }
    const client = new MongoClient(MONGODB_CONNECTION);
    await client.connect();
    try {
        const job = await getCollection(client, 'jobs').findOne({ _id: new ObjectId(jobId) });
        if (!job)
            throw jobNotFoundError;
        response.status(200).json({
            topXLetterResults: (await getCollection(client, 'coverLetters').find().toArray()).map(cl => ({
                coverLetterText: reconstructCoverLetterText(getCoverLetterTextSegments(cl)),
                similarity: calculateWeightedCoverLetterSimilarity(job.embedding, cl),
            })).sort((first, second) => second.similarity - first.similarity).slice(0, topX)
        });
    }
    catch (error) {
        createErrorMessage(response, error, "An error occurred while processing the request", error instanceof Error && error.message === jobNotFoundError.message ? 404 : 500);
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=getTopXSimilarCoverLetters.js.map