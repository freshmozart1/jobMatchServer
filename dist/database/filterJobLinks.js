import { MongoClient } from "mongodb";
import { mongoDbConnectionString } from "./database.js";
const invalidFilterJobLinksRequestResponse = {
    message: "Request body must be an object mapping keywords to URL arrays",
};
function isValidLinkedInJobLinksByKeyword(body) {
    return typeof body === "object"
        && body !== null
        && !Array.isArray(body)
        && Object.values(body).every((value) => Array.isArray(value) && value.every((url) => typeof url === "string"));
}
export default async function filterJobLinks(request, response) {
    if (!isValidLinkedInJobLinksByKeyword(request.body)) {
        response.status(400).json(invalidFilterJobLinksRequestResponse);
        return;
    }
    const urls = Object.values(request.body).flat();
    const uniqueUrls = [...new Set(urls)];
    if (uniqueUrls.length === 0) {
        response.status(200).json(request.body);
        return;
    }
    const client = new MongoClient(mongoDbConnectionString);
    await client.connect();
    try {
        const database = client.db('jobMatch');
        const jobsCollection = database.collection('jobs');
        const storedJobs = await jobsCollection
            .find({ sourceUrl: { $in: uniqueUrls } }, { projection: { sourceUrl: 1, _id: 0 } })
            .toArray();
        const storedSourceUrls = new Set(storedJobs.map(({ sourceUrl }) => sourceUrl));
        const filteredJobLinks = Object.fromEntries(Object.entries(request.body).map(([keyword, keywordUrls]) => [
            keyword,
            keywordUrls.filter((url) => !storedSourceUrls.has(url)),
        ]));
        response.status(200).json(filteredJobLinks);
    }
    catch (error) {
        console.error("Error filtering job links:", error);
        response.status(500).json({ message: "An error occurred while filtering job links" });
    }
    finally {
        await client.close();
    }
}
//# sourceMappingURL=filterJobLinks.js.map