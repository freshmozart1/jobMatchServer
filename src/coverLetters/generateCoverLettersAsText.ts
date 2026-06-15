import type { ScrapedJob, StoredCoverLetter } from "#types";
import type { Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import fetchTokens from "../tokens/fetchTokens.js";
import OpenAI from "openai";
import { getCoverLetterTextSegments, reconstructCoverLetterText } from "./coverLetterSegmentation.js";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "#database/database.js";
import { createErrorMessage } from "../errors/createErrorMessage.js";

type GenerateCoverLetterAsTextRequestBody = ScrapedJob & {
    coverLetterIds: string[];
}

function isValidScrapedJobBody(body: unknown): boolean {
    return typeof body === "object"
        && body !== null
        && "sourceHostname" in body
        && typeof body.sourceHostname === "string"
        && "sourceUrl" in body
        && typeof body.sourceUrl === "string"
        && "title" in body
        && typeof body.title === "string"
        && "company" in body
        && typeof body.company === "string"
        && "location" in body
        && (typeof body.location === "string" || body.location === undefined)
        && "descriptionText" in body
        && (typeof body.descriptionText === "string" || body.descriptionText === undefined)
        && "postedAt" in body
        && (typeof body.postedAt === "string" || body.postedAt === undefined)
        && "scrapedAt" in body
        && typeof body.scrapedAt === "string"
        && "tags" in body
        && (body.tags === undefined || (Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === "string")))
        && "duplicateKey" in body
        && typeof body.duplicateKey === "string";
}

export function isValidGenerateCoverLetterAsTextRequestBody(body: unknown): body is GenerateCoverLetterAsTextRequestBody {
    return isValidScrapedJobBody(body)
        && typeof body === "object"
        && body !== null
        && "coverLetterIds" in body
        && Array.isArray(body.coverLetterIds)
        && body.coverLetterIds.every((id) => /^[0-9a-f]{24}$/.test(id));
}

function jobToText(job: ScrapedJob): string {
    return `Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? "Not specified"}
Description: ${job.descriptionText ?? "Not specified"}
Tags: ${job.tags ? job.tags.join(", ") : "Not specified"}`;
}

export default async function generateCoverLetterAsText(req: Request<object, object, GenerateCoverLetterAsTextRequestBody>, res: Response): Promise<void> {
    if (!isValidGenerateCoverLetterAsTextRequestBody(req.body)) {
        createErrorMessage(res, '', "Invalid request body. Please provide all required fields with correct types.", 400);
        return;
    }

    const { coverLetterIds, ...jobData } = req.body;

    if (!connectionStringConfigured(res)) return;

    const client = new MongoClient(MONGODB_CONNECTION!);

    await client.connect();

    const coverLettersNotFoundForIdsStart = 'Cover letters not found for IDs: ';

    try {
        const coverLetters = await getCollection<StoredCoverLetter>(client, 'coverLetters').find({ _id: { $in: coverLetterIds.map(id => new ObjectId(id)) } }).toArray();
        if (coverLetters.length !== coverLetterIds.length) {
            const foundIds = new Set(coverLetters.map(cl => cl._id.toString()));
            const notFoundIds = coverLetterIds.filter(id => !foundIds.has(id));
            throw new Error(coverLettersNotFoundForIdsStart + notFoundIds.join(", "));
        }
        
        const instructions = `You are an experienced career counselor who crafts professional, authentic cover letters. You carefully analyze sample cover letters to identify and incorporate the writer’s writing style, tone, and personal characteristics.`;
        const input = `Write a cover letter for the following job vacancy:\n\n${jobToText(jobData)}\n\n---\n\nSample cover letters for style and content review:\n\n${coverLetters.map((cl, index) => `Cover Letter ${index + 1}:\n${reconstructCoverLetterText(getCoverLetterTextSegments(cl))}`).join("\n\n")}\n\n---\n\nWrite a new cover letter tailored specifically to this position. Adopt the personal writing style and tone used in the references. Carefully tailor the wording, specific points, and key focus areas to this position. Return only the final cover letter, without any comments. Use the same language in the cover letter as in the job posting.`;

        let tokenCount;

        try {
            const tokenServiceResponse = await fetchTokens(instructions + "\n\n" + input);
            if (tokenServiceResponse.ok) tokenCount = await tokenServiceResponse.text();
        } catch (error) {
            tokenCount = "Error calculating tokens: " + (error instanceof Error ? error.message : String(error));
        }

        const aiClient = new OpenAI();

        const aiResponse = await aiClient.responses.create({
            model: 'gpt-5.5',
            instructions,
            input
        });

        res.status(200).json({ coverLetter: aiResponse.output_text, inputTokenCount: tokenCount });
    } catch (error) {
        const isCoverLettersNotFoundForIdError = error instanceof Error && error.message.startsWith(coverLettersNotFoundForIdsStart);
        createErrorMessage(res, error, isCoverLettersNotFoundForIdError
            ? error.message
            : "Error retrieving cover letters from database", isCoverLettersNotFoundForIdError
            ? 404
            : 500
        );
    } finally {
        await client.close();
    }
};