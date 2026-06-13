import { segmentCoverLetter } from "../coverLetters/coverLetterSegmentation.js";
import { createStoredCoverLetterFromTextSegments } from "../coverLetters/coverLetterEmbeddings.js";
import { MongoClient } from "mongodb";
import { mongoDbConnectionString } from "./database.js";
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
    if (!isValidCoverLetterAsTextRequestBody(request.body)) {
        response.status(400).json({ message: "Request body must include a non-empty coverLetterText string and may include a non-empty jobDuplicateKey string" });
        return;
    }
    const { coverLetterText, jobDuplicateKey } = request.body;
    const { segments } = await segmentCoverLetter(coverLetterText);
    const coverLetter = await createStoredCoverLetterFromTextSegments(segments);
    const client = new MongoClient(mongoDbConnectionString);
    const coverLettersCollection = client.db('jobMatch').collection('coverLetters');
    await client.connect();
    try {
        if (jobDuplicateKey) {
            const upserted = await coverLettersCollection.findOneAndReplace({ jobDuplicateKey }, { ...coverLetter, jobDuplicateKey }, { upsert: true, returnDocument: "after" });
            response.status(201).json({ message: "Cover letter uploaded", coverLetterId: upserted?._id });
        }
        const result = await coverLettersCollection.insertOne(coverLetter);
        response.status(201).json({ message: "Cover letter uploaded", coverLetterId: result.insertedId });
    }
    catch (error) {
        console.error("Error uploading cover letter:", error);
        response.status(500).json({ message: "An error occurred while uploading the cover letter", error: error instanceof Error ? error.message : String(error) });
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=uploadCoverLetterAsText.js.map