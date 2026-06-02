import type { Request, Response } from "express";
import type { ScrapedJob } from "#types";
import { MongoClient } from "mongodb";

export default async function createJobInDatabase(request: Request<object, object, ScrapedJob>, response: Response): Promise<void> {
    const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
    const client = new MongoClient(mongoDbConnectionString);
    try {
        const database = client.db('jobMatch');
        const jobsCollection = database.collection('jobs');
        const jobData = request.body;
        const result = await jobsCollection.insertOne(jobData);
        response.status(201).json({ message: "Job created", jobId: result.insertedId });
    }
    finally {
        await client.close();
    }
}