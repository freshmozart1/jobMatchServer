import type { Request, Response } from "express";
import { client, coverLettersCollection } from "./database.js";
import { segmentCoverLetter } from "../coverLetters/coverLetterSegmentation.js";
import { createStoredCoverLetterFromTextSegments } from "../coverLetters/coverLetterEmbeddings.js";

type CoverLetterAsTextRequestBody = {
    coverLetterText: string;
};

function isValidCoverLetterAsTextRequestBody(body: unknown): body is CoverLetterAsTextRequestBody {
    return typeof body === "object"
        && body !== null
        && "coverLetterText" in body
        && typeof body.coverLetterText === "string"
        && body.coverLetterText.trim().length > 0;
}

export default async function uploadCoverLetterAsText(request: Request<object, object, CoverLetterAsTextRequestBody>, response: Response): Promise<void> {
    if (!isValidCoverLetterAsTextRequestBody(request.body)) {
        response.status(400).json({ message: "Request body must include coverLetterText field of type string and must not be empty" });
        return;
    }

    const { coverLetterText } = request.body;

    const { segments } = await segmentCoverLetter(coverLetterText);
    const coverLetter = await createStoredCoverLetterFromTextSegments(segments);

    await client.connect();

    const result = await coverLettersCollection.insertOne(coverLetter);
    response.status(201).json({ message: "Cover letter uploaded", coverLetterId: result.insertedId });
}