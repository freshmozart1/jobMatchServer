import type { Request, Response } from "express";
import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import type { StoredCv, StoredScrapedJob } from "#types";
import { createErrorMessage } from "../errors/createErrorMessage.js";

export default async function getCVStatus(
    request: Request<{ jobDuplicateKey: string }>,
    response: Response
): Promise<void> {
    if (!connectionStringConfigured(response)) return;

    const { jobDuplicateKey } = request.params;
    const jobNotFoundError = new Error("Job not found");
    const cvNotFoundError = new Error("CV not found");

    let client: MongoClient | undefined;
    try {
        client = new MongoClient(MONGODB_CONNECTION!);
        await client.connect();
        const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne({ duplicateKey: jobDuplicateKey });
        if (!job) throw jobNotFoundError;

        const cv = await getCollection<StoredCv>(client, 'cv').findOne({ jobId: job._id.toHexString() });
        if (!cv) throw cvNotFoundError;

        response.status(200).json({ message: "CV exists" });
    } catch (error) {
        createErrorMessage(
            response,
            error,
            "Error checking CV status",
            error === jobNotFoundError || error === cvNotFoundError ? 404 : 500
        );
    } finally {
        await client?.close();
    }
}
