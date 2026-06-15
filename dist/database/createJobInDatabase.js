import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";
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
    const invalidBodyErrorMessage = "Request body must include job and boolean like fields";
    if (!connectionStringConfigured(response))
        return;
    if (!isValidCreateJobRequestBody(request.body)) {
        response.status(400).json({ message: invalidBodyErrorMessage, error: invalidBodyErrorMessage });
        return;
    }
    const { job, like } = request.body;
    const client = new MongoClient(MONGODB_CONNECTION);
    await client.connect();
    try {
        const result = await getCollection(client, 'jobs').findOneAndReplace({ duplicateKey: job.duplicateKey }, { ...job, like }, { upsert: true, returnDocument: 'after' });
        response.status(201).json({ message: "Job created", jobId: result?._id });
    }
    catch (error) {
        createErrorMessage(response, error, "Failed to create job in database");
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=createJobInDatabase.js.map