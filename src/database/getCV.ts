import type { Request, Response } from "express";
import { MongoClient } from "mongodb";
import path from "path";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import type { StoredCv, StoredScrapedJob } from "#types";
import { createErrorMessage } from "../errors/createErrorMessage.js";

export default async function getCV(
    request: Request<{ jobDuplicateKey: string }>,
    response: Response
): Promise<void> {
    if (!connectionStringConfigured(response)) return;

    const { jobDuplicateKey } = request.params;
    const jobNotFoundError = new Error("Job not found");
    const cvNotFoundError = new Error("CV not found");

    const client = new MongoClient(MONGODB_CONNECTION!);
    await client.connect();

    try {
        const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne({ duplicateKey: jobDuplicateKey });
        if (!job) throw jobNotFoundError;

        const cv = await getCollection<StoredCv>(client, 'cv').findOne({ jobId: job._id.toHexString() });
        if (!cv) throw cvNotFoundError;

        response.sendFile(path.resolve(cv.filePath));
    } catch (error) {
        createErrorMessage(
            response,
            error,
            "Error retrieving CV",
            error instanceof Error && (
                error.message === jobNotFoundError.message ||
                error.message === cvNotFoundError.message
            ) ? 404 : 500
        );
    } finally {
        await client.close();
    }
}
