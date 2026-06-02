import type { Request, Response } from "express";
import type { CreateJobInDatabaseRequestBody, StoredScrapedJob } from "#types";
import { MongoClient } from "mongodb";
import { createJobEmbedding } from "../embeddings/jobEmbedding.js";
import { isOllamaAvailable } from "../ollama/ollamaServer.js";

const ollamaUnavailableResponse = { message: "Ollama not available" };

function isValidCreateJobRequestBody(body: unknown): body is CreateJobInDatabaseRequestBody {
    return typeof body === "object"
        && body !== null
        && "job" in body
        && typeof body.job === "object"
        && body.job !== null
        && "like" in body
        && typeof body.like === "boolean";
}

export default async function createJobInDatabase(request: Request<object, object, CreateJobInDatabaseRequestBody>, response: Response): Promise<void> {
    if (!isValidCreateJobRequestBody(request.body)) {
        response.status(400).json({ message: "Request body must include job and boolean like fields" });
        return;
    }

    const { job, like } = request.body;

    if (!(await isOllamaAvailable())) {
        response.status(503).json(ollamaUnavailableResponse);
        return;
    }

    let embedding: StoredScrapedJob["embedding"];

    try {
        embedding = await createJobEmbedding(job);
    } catch {
        response.status(503).json(ollamaUnavailableResponse);
        return;
    }

    const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
    const client = new MongoClient(mongoDbConnectionString);
    try {
        const database = client.db('jobMatch');
        const jobsCollection = database.collection<StoredScrapedJob>('jobs');
        const jobData: StoredScrapedJob = { ...job, like, embedding };
        const result = await jobsCollection.insertOne(jobData);
        response.status(201).json({ message: "Job created", jobId: result.insertedId });
    }
    finally {
        await client.close();
    }
}