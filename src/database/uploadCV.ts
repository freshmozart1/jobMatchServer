import type { Request, Response } from "express";
import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import type { StoredCv, StoredScrapedJob } from "#types";
import { createErrorMessage } from "../errors/createErrorMessage.js";

export default async function uploadCV(request: Request, response: Response): Promise<void> {
    const jobDuplicateKey = request.body["jobDuplicateKey"] as unknown;
    const jobDuplicateKeyMustBeStringError = new Error("jobDuplicateKey must be a string");
    const fileRequiredError = new Error("file is required");
    const fileMustBePdfError = new Error("file must be a PDF");
    const jobNotFoundError = new Error("Job not found");

    if (!connectionStringConfigured(response)) return;

    if (typeof jobDuplicateKey !== "string") {
        createErrorMessage(response, jobDuplicateKeyMustBeStringError, "Error uploading CV", 400);
        return;
    }
    if (!request.file) {
        createErrorMessage(response, fileRequiredError, "Error uploading CV", 400);
        return;
    }
    if (!(request.file.mimetype === "application/pdf" || request.file.originalname.toLowerCase().endsWith(".pdf"))) {
        createErrorMessage(response, fileMustBePdfError, "Error uploading CV", 400);
        return;
    }

    const client = new MongoClient(MONGODB_CONNECTION!);
    await client.connect();

    try {
        const job = await client.db('jobMatch').collection<StoredScrapedJob>('jobs').findOne({ duplicateKey: jobDuplicateKey });

        if (!job) throw jobNotFoundError;

        const result = await getCollection<StoredCv>(client, 'cv').insertOne({
            jobId: job._id.toHexString(),
            filePath: request.file.path,
        });
        response.status(201).json({ message: "CV uploaded", cvId: result.insertedId });
    } catch (error) {
        createErrorMessage(response, error, "Error uploading CV", error instanceof Error && error.message === jobNotFoundError.message ? 404 : 500);
    } finally {
        await client.close();
    }
}
