import { client, jobsCollection } from "./database.js";
import { createJobEmbedding } from "../embeddings/jobEmbedding.js";
import { isOllamaAvailable, sendOllamaUnavailableResponse } from "../ollama/ollamaServer.js";
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
    let embedding;
    try {
        if (!(await isOllamaAvailable()))
            throw {};
        embedding = await createJobEmbedding(job);
    }
    catch {
        sendOllamaUnavailableResponse(response);
        return;
    }
    await client.connect();
    const result = await jobsCollection.insertOne({ ...job, like, embedding });
    await client.close();
    response.status(201).json({ message: "Job created", jobId: result.insertedId });
}
//# sourceMappingURL=createJobInDatabase.js.map