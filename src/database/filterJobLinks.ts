import type { StoredScrapedJob, LinkedInJobLinksByKeyword } from "#types";
import type { Request, Response } from "express";
import { MongoClient } from "mongodb";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";

function isValidLinkedInJobLinksByKeyword(body: unknown): body is LinkedInJobLinksByKeyword {
	return typeof body === "object"
		&& body !== null
		&& !Array.isArray(body)
		&& Object.values(body).every((value) => Array.isArray(value) && value.every((url) => typeof url === "string"));
}

export default async function filterJobLinks(
	request: Request<object, object, LinkedInJobLinksByKeyword>,
	response: Response,
): Promise<void> {

	if (!connectionStringConfigured(response)) return;

	const requestBodyMustBeObjectError = new Error("Request body must be an object mapping keywords to URL arrays");

	if (!isValidLinkedInJobLinksByKeyword(request.body)) {
		createErrorMessage(response, requestBodyMustBeObjectError, requestBodyMustBeObjectError.message, 400);
		return;
	}

	const client = new MongoClient(MONGODB_CONNECTION!);
	await client.connect();

	const jobsCollection = getCollection<StoredScrapedJob>(client, 'jobs');
	try {
		const uniqueUrls = [...new Set(Object.values(request.body).flat())];
		if (uniqueUrls.length === 0) {
			response.status(200).json(request.body);
			return;
		}
		const storedJobs = await jobsCollection
			.find({ sourceUrl: { $in: uniqueUrls } }, { projection: { sourceUrl: 1, _id: 0 } })
			.toArray();
		const storedSourceUrls = new Set(storedJobs.map(({ sourceUrl }) => sourceUrl));

		response.status(200).json(Object.fromEntries(
			Object.entries(request.body).map(([keyword, keywordUrls]) => [
				keyword,
				keywordUrls.filter((url) => !storedSourceUrls.has(url)),
			]),
		));
	} catch (error) {
		createErrorMessage(response, error, "An error occurred while filtering job links");
	} finally {
		await client.close();
	}
}