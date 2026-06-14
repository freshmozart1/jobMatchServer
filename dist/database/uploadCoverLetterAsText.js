import { segmentCoverLetter } from "../coverLetters/coverLetterSegmentation.js";
import { createStoredCoverLetterFromTextSegments } from "../coverLetters/coverLetterEmbeddings.js";
import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";
function isValidCoverLetterAsTextRequestBody(body) {
    return typeof body === "object"
        && body !== null
        && "coverLetterText" in body
        && typeof body.coverLetterText === "string"
        && body.coverLetterText.trim().length > 0
        && (!("jobDuplicateKey" in body)
            || (typeof body.jobDuplicateKey === "string" && body.jobDuplicateKey.trim().length > 0));
}
export default async function uploadCoverLetterAsText(request, response) {
    const invalidCoverLetterAsTextRequestBodyError = new Error("Invalid request body. Please provide a non-empty coverLetterText string and optionally a non-empty jobDuplicateKey string.");
    if (!connectionStringConfigured(response))
        return;
    const client = new MongoClient(MONGODB_CONNECTION);
    await client.connect();
    try {
        if (!isValidCoverLetterAsTextRequestBody(request.body))
            throw invalidCoverLetterAsTextRequestBodyError;
        const coverLettersCollection = getCollection(client, 'coverLetters');
        const { coverLetterText, jobDuplicateKey } = request.body;
        const { segments } = await segmentCoverLetter(coverLetterText);
        const coverLetter = await createStoredCoverLetterFromTextSegments(segments);
        if (jobDuplicateKey) {
            const upserted = await coverLettersCollection.findOneAndReplace({ jobDuplicateKey }, { ...coverLetter, jobDuplicateKey }, { upsert: true, returnDocument: "after" });
            response.status(201).json({ message: "Cover letter uploaded", coverLetterId: upserted?._id });
        }
        const result = await coverLettersCollection.insertOne(coverLetter);
        response.status(201).json({ message: "Cover letter uploaded", coverLetterId: result.insertedId });
    }
    catch (error) {
        createErrorMessage(response, error, "An error occurred while uploading the cover letter", error instanceof Error && error.message === invalidCoverLetterAsTextRequestBodyError.message
            ? 400
            : 500);
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=uploadCoverLetterAsText.js.map