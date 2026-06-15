import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";
export default async function uploadCV(request, response) {
    const jobId = request.body["jobId"];
    const jobIdMustBeStringError = new Error("jobId must be a string");
    const fileRequiredError = new Error("file is required");
    const fileMustBePdfError = new Error("file must be a PDF");
    const jobNotFoundError = new Error("Job not found");
    if (!connectionStringConfigured(response))
        return;
    if (typeof jobId !== "string") {
        createErrorMessage(response, jobIdMustBeStringError, "Error uploading CV", 400);
        return;
    }
    if (!request.file) {
        createErrorMessage(response, fileRequiredError, "Error uploading CV", 400);
        return;
    }
    if (!(request.file.mimetype === "application/pdf" || request.file.originalname.toLowerCase().endsWith(".pdf"))) {
        createErrorMessage(response, fileMustBePdfError, "Error uploading CV", 400);
        return;
    }
    const client = new MongoClient(MONGODB_CONNECTION);
    await client.connect();
    try {
        const job = await client.db('jobMatch').collection('jobs').findOne({ sourceJobId: jobId });
        if (!job)
            throw jobNotFoundError;
        const result = await getCollection(client, 'cv').insertOne({
            jobId: job._id.toHexString(),
            filePath: request.file.path,
        });
        response.status(201).json({ message: "CV uploaded", cvId: result.insertedId });
    }
    catch (error) {
        createErrorMessage(response, error, "Error uploading CV", error instanceof Error && error.message === jobNotFoundError.message ? 404 : 500);
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=uploadCV.js.map