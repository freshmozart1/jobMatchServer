import { embed } from "../embeddings/embeddings.js";
import { client, coverLettersCollection } from "./database.js";
function isValidCoverLetterAsTextRequestBody(body) {
    return typeof body === "object"
        && body !== null
        && "coverLetterText" in body
        && typeof body.coverLetterText === "string"
        && body.coverLetterText.trim().length > 0;
}
export default async function uploadCoverLetterAsText(request, response) {
    if (!isValidCoverLetterAsTextRequestBody(request.body)) {
        response.status(400).json({ message: "Request body must include coverLetterText field of type string and must not be empty" });
        return;
    }
    const { coverLetterText } = request.body;
    const embedding = await embed(coverLetterText);
    await client.connect();
    const result = await coverLettersCollection.insertOne({ coverLetterText, embedding });
    response.status(201).json({ message: "Cover letter uploaded", coverLetterId: result.insertedId });
}
//# sourceMappingURL=uploadCoverLetterAsText.js.map