import type { Request, Response } from "express";
import type { CreateJobInDatabaseRequestBody } from "#types";
import { client, jobsCollection } from "./database.js";

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

    await client.connect();

    const result = await jobsCollection.insertOne({ ...job, like });

    response.status(201).json({ message: "Job created", jobId: result.insertedId });
}
