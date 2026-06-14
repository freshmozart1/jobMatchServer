import type { Request, Response } from "express";
import type { CreateJobInDatabaseRequestBody, StoredScrapedJob } from "#types";
import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";

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
    const invalidBodyErrorMessage = "Request body must include job and boolean like fields";
    const { job, like } = request.body;

    if (!connectionStringConfigured(response)) return;

    const client = new MongoClient(MONGODB_CONNECTION!);
    await client.connect();

    try {
        if (!isValidCreateJobRequestBody(request.body)) throw new Error(invalidBodyErrorMessage);
        const result = await getCollection<StoredScrapedJob>(client, 'jobs').insertOne({ ...job, like });
        response.status(201).json({ message: "Job created", jobId: result.insertedId });
    } catch (error) {
        const isInvalidBodyError = error instanceof Error && error.message === invalidBodyErrorMessage;
        createErrorMessage(
            response,
            error,
            isInvalidBodyError
                ? invalidBodyErrorMessage
                : "Failed to create job in database",
            isInvalidBodyError
                ? 400
                : 500
        );
    } finally {
        await client.close();
    }
}
