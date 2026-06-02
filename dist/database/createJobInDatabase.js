import { MongoClient } from "mongodb";
import { createJobEmbedding } from "../embeddings/jobEmbedding.js";
function isValidCreateJobRequestBody(body) {
    return typeof body === "object"
        && body !== null
        && "job" in body
        && typeof body.job === "object"
        && body.job !== null
        && "like" in body
        && typeof body.like === "boolean";
}
export default async function createJobInDatabase(request, response) {
    if (!isValidCreateJobRequestBody(request.body)) {
        response.status(400).json({ message: "Request body must include job and boolean like fields" });
        return;
    }
    const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
    const client = new MongoClient(mongoDbConnectionString);
    try {
        const database = client.db('jobMatch');
        const jobsCollection = database.collection('jobs');
        const { job, like } = request.body;
        const embedding = await createJobEmbedding(job);
        const jobData = { ...job, like, embedding };
        const result = await jobsCollection.insertOne(jobData);
        response.status(201).json({ message: "Job created", jobId: result.insertedId });
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=createJobInDatabase.js.map