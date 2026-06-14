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
    const client = new MongoClient(MONGODB_CONNECTION);
    await client.connect();
    try {
        if (typeof jobId !== "string")
            throw jobIdMustBeStringError;
        if (!request.file)
            throw fileRequiredError;
        if (!(request.file.mimetype === "application/pdf" || request.file.originalname.toLowerCase().endsWith(".pdf")))
            throw fileMustBePdfError;
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
        createErrorMessage(response, error, "Error uploading CV", error instanceof Error && error.message === jobNotFoundError.message ? 404 : 400);
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=uploadCV.js.map