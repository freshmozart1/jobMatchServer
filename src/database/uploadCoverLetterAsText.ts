import type { Request, Response } from "express";
import { embed } from "../embeddings/embeddings.js";
import { isOllamaAvailable, sendOllamaUnavailableResponse } from "../ollama/ollamaServer.js";
import type { TextEmbedding } from "#types";
import { client, coverLettersCollection } from "./database.js";

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

    let embedding: TextEmbedding;

    try {
        if (!(await isOllamaAvailable())) throw {};
        embedding = await embed(coverLetterText);
    } catch {
        sendOllamaUnavailableResponse(response);
        return;
    }

    await client.connect();

    const result = await coverLettersCollection.insertOne({ coverLetterText, embedding });
    response.status(201).json({ message: "Cover letter uploaded", coverLetterId: result.insertedId });
}