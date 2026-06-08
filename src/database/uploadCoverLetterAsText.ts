import type { Request, Response } from "express";
import { embed } from "../embeddings/embeddings.js";
import { isOllamaAvailable, sendOllamaUnavailableResponse } from "../ollama/ollamaServer.js";
import type { TextEmbedding } from "#types";
import { client, coverLettersCollection } from "./database.js";

type CvAsTextRequestBody = {
    coverLetterText: string;
};

function isValidCvAsTextRequestBody(body: unknown): body is CvAsTextRequestBody {
    return typeof body === "object"
        && body !== null
        && "coverLetterText" in body
        && typeof body.coverLetterText === "string";
}

export default async function uploadCoverLetterAsText(request: Request<object, object, CvAsTextRequestBody>, response: Response): Promise<void> {
    if (!isValidCvAsTextRequestBody(request.body)) {
        response.status(400).json({ message: "Request body must include coverLetterText field of type string" });
        return;
    }

    const { coverLetterText } = request.body;

    if (!(await isOllamaAvailable())) sendOllamaUnavailableResponse(response);

    let embedding: TextEmbedding;

    try {
        embedding = await embed(coverLetterText);
    } catch {
        sendOllamaUnavailableResponse(response);
        return;
    }

    await client.connect();

    const result = await coverLettersCollection.insertOne({ coverLetterText, embedding });
    response.status(201).json({ message: "Cover letter uploaded", coverLetterId: result.insertedId });
}