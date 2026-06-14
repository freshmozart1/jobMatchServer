import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";
function isValidLinkedInJobLinksByKeyword(body) {
    return typeof body === "object"
        && body !== null
        && !Array.isArray(body)
        && Object.values(body).every((value) => Array.isArray(value) && value.every((url) => typeof url === "string"));
}
export default async function filterJobLinks(request, response) {
    if (!connectionStringConfigured(response))
        return;
    const client = new MongoClient(MONGODB_CONNECTION);
    const requestBodyMustBeObjectError = new Error("Request body must be an object mapping keywords to URL arrays");
    await client.connect();
    const jobsCollection = getCollection(client, 'jobs');
    try {
        if (!isValidLinkedInJobLinksByKeyword(request.body))
            throw requestBodyMustBeObjectError;
        const uniqueUrls = [...new Set(Object.values(request.body).flat())];
        if (uniqueUrls.length === 0) {
            response.status(200).json(request.body);
            return;
        }
        const storedJobs = await jobsCollection
            .find({ sourceUrl: { $in: uniqueUrls } }, { projection: { sourceUrl: 1, _id: 0 } })
            .toArray();
        const storedSourceUrls = new Set(storedJobs.map(({ sourceUrl }) => sourceUrl));
        response.status(200).json(Object.fromEntries(Object.entries(request.body).map(([keyword, keywordUrls]) => [
            keyword,
            keywordUrls.filter((url) => !storedSourceUrls.has(url)),
        ])));
    }
    catch (error) {
        const isRequestBodyError = error instanceof Error && error.message === requestBodyMustBeObjectError.message;
        createErrorMessage(response, error, isRequestBodyError ? requestBodyMustBeObjectError.message : "An error occurred while filtering job links", isRequestBodyError ? 400 : 500);
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=filterJobLinks.js.map