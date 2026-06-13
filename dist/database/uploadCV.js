import { MongoClient } from "mongodb";
import { mongoDbConnectionString } from "./database.js";
export default async function uploadCV(request, response) {
    const jobId = request.body["jobId"];
    if (typeof jobId !== "string") {
        response.status(400).json({ message: "jobId must be a string" });
        return;
    }
    if (!request.file) {
        response.status(400).json({ message: "file is required" });
        return;
    }
    const isPdf = request.file.mimetype === "application/pdf" ||
        request.file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
        response.status(400).json({ message: "file must be a PDF" });
        return;
    }
    const client = new MongoClient(mongoDbConnectionString);
    await client.connect();
    try {
        const job = await client.db('jobMatch').collection('jobs').findOne({ sourceJobId: jobId });
        if (!job) {
            response.status(404).json({ message: "Job not found" });
            return;
        }
        const result = await client.db('jobMatch').collection('cv').insertOne({
            jobId: job._id,
            filePath: request.file.path,
        });
        response.status(201).json({ message: "CV uploaded", cvId: result.insertedId });
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=uploadCV.js.map