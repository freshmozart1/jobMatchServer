import type { ScrapedJob, StoredCoverLetter } from "#types";
import type { Request, Response } from "express";
import { client, coverLettersCollection } from "#database/database.js";
import { ObjectId } from "mongodb";
import { isOllamaAvailable, sendOllamaUnavailableResponse } from "./ollamaServer.js";
import ollama from 'ollama';

type GenerateCoverLetterAsTextRequestBody = ScrapedJob & {
    coverLetterIds: string[];
}

const TEXT_GENERATION_MODEL = 'gemma4';
const SYSTEM_PROMPT = `You are an experienced career counselor who crafts professional, authentic cover letters. You carefully analyze sample cover letters to identify and incorporate the writer’s writing style, tone, and personal characteristics.`;

function isValidGenerateCoverLetterAsTextRequestBody(body: unknown): body is GenerateCoverLetterAsTextRequestBody {
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
        && (Array.isArray(body.tags) && body.tags.every((tag) => typeof tag === "string") || body.tags === undefined)
        && "duplicateKey" in body
        && typeof body.duplicateKey === "string"
        && "coverLetterIds" in body
        && Array.isArray(body.coverLetterIds)
        && body.coverLetterIds.every((id) => typeof id === "string");
}

function jobToText(job: ScrapedJob): string {
    return `Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location ?? "Not specified"}
Description: ${job.descriptionText ?? "Not specified"}
Tags: ${job.tags ? job.tags.join(", ") : "Not specified"}`;
}

export default async function generateCoverLetterAsText(req: Request<object, object, GenerateCoverLetterAsTextRequestBody>, res: Response): Promise<void> {
    if (!(await isOllamaAvailable())) {
        sendOllamaUnavailableResponse(res);
        return;
    }
    if (!isValidGenerateCoverLetterAsTextRequestBody(req.body)) {
        res.status(400).json({ message: "Invalid request body. Please provide all required fields with correct types." });
        return;
    }

    const { coverLetterIds, ...jobData } = req.body;

    const coverletterObjectIds = coverLetterIds.map((id) => {
        try {
            return new ObjectId(id);
        } catch {
            res.status(400).json({ message: `Invalid cover letter ID: ${id}` });
            throw new Error(`Invalid cover letter ID: ${id}`);
        }
    });

    await client.connect();

    let coverLetters: (StoredCoverLetter & { _id: ObjectId })[];

    try {
        coverLetters = await coverLettersCollection.find({ _id: { $in: coverletterObjectIds } }).toArray();
    } catch (error) {
        res.status(500).json({ message: "Error retrieving cover letters from database", error: error instanceof Error ? error.message : String(error) });
        return;
    } finally {
        await client.close();
    }

    if (coverLetters.length !== coverLetterIds.length) {
        const foundIds = new Set(coverLetters.map((cl) => cl._id.toString()));
        const notFoundIds = coverLetterIds.filter((id) => !foundIds.has(id));
        res.status(404).json({ message: `Cover letters not found for IDs: ${notFoundIds.join(", ")}` });
        return;
    }

    const userMessage = { role: 'user', content: `Erstelle ein Anschreiben für folgendes Stellenangebot:\n\n${jobToText(jobData)}\n\n---\n\nSample cover letters for style and content review:\n\n${coverLetters.map((cl, index) => `Cover Letter ${index + 1}:\n${cl.coverLetterText}`).join("\n\n")}\n\n---\n\nWrite a new cover letter tailored specifically to this position. Adopt the personal writing style and tone used in the references. Carefully tailor the wording, specific points, and key focus areas to this position. Return only the final cover letter, without any comments. Use the same language in the cover letter as in the job posting.` };

    console.log('User message for cover letter generation:', userMessage.content);

    const {response, done, done_reason} = await ollama.generate({
        model: TEXT_GENERATION_MODEL,
        prompt: userMessage.content,
        system: SYSTEM_PROMPT,
        think: 'high'
    });

    if (done) console.log(`Ollama generation completed with reason: ${done_reason}`);
    
    let coverLetterText = "";
    if (response) {
        coverLetterText = response;
    }

    res.status(200).json({ coverLetterText });
};