import { MongoClient } from "mongodb";
import { mongoDbConnectionString } from "./database.js";
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
    const { job, like } = request.body;
    const client = new MongoClient(mongoDbConnectionString);
    await client.connect();
    try {
        const result = await client.db('jobMatch').collection('jobs').insertOne({ ...job, like });
        response.status(201).json({ message: "Job created", jobId: result.insertedId });
    }
    catch (error) {
        console.error("Error inserting job into database:", error);
        response.status(500).json({ message: "Error inserting job into database", error: error instanceof Error ? error.message : String(error) });
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=createJobInDatabase.js.map