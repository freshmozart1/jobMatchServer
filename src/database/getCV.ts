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
    try {
        await client.connect();
        const job = await getCollection<StoredScrapedJob>(client, 'jobs').findOne({ duplicateKey: jobDuplicateKey });
        if (!job) throw jobNotFoundError;

        const cv = await getCollection<StoredCv>(client, 'cv').findOne({ jobId: job._id.toHexString() });
        if (!cv) throw cvNotFoundError;

        const uploadsDir = path.resolve('uploads/cv');
        const resolvedPath = path.resolve(cv.filePath);
        const relativePath = path.relative(uploadsDir, resolvedPath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            createErrorMessage(response, new Error('Invalid file path'), 'Error retrieving CV', 500);
            return;
        }

        response.setHeader('Content-Type', 'application/pdf');
        await new Promise<void>((resolve, reject) => {
            response.sendFile(resolvedPath, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    } catch (error) {
        createErrorMessage(
            response,
            error,
            "Error retrieving CV",
            error === jobNotFoundError || error === cvNotFoundError ? 404 : 500
        );
    } finally {
        await client.close();
    }
}
