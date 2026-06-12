import type { Request, Response } from "express";
import { client, jobsCollection, cvCollection } from "./database.js";

export default async function uploadCV(request: Request, response: Response): Promise<void> {
    const jobId = request.body["jobId"] as unknown;

    if (typeof jobId !== "string") {
        response.status(400).json({ message: "jobId must be a string" });
        return;
    }

    if (!request.file) {
        response.status(400).json({ message: "file is required" });
        return;
    }

    const isPdf =
        request.file.mimetype === "application/pdf" ||
        request.file.originalname.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
        response.status(400).json({ message: "file must be a PDF" });
        return;
    }

    await client.connect();

    try {
        const job = await jobsCollection.findOne({ sourceJobId: jobId });

        if (!job) {
            response.status(404).json({ message: "Job not found" });
            return;
        }

        const result = await cvCollection.insertOne({
            jobId: job._id,
            filePath: request.file.path,
        });
        response.status(201).json({ message: "CV uploaded", cvId: result.insertedId });
    } finally {
        await client.close();
    }
}
