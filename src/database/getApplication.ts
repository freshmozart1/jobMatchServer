import type { Request, Response } from "express";
import { readFile } from "fs/promises";
import { MongoClient } from "mongodb";
import path from "path";
import { PDFDocument } from "pdf-lib";
import puppeteer from "puppeteer";
import { createErrorMessage } from "../errors/createErrorMessage.js";
import type { CoverLetterSegmentName, StoredCoverLetter, StoredCv, StoredScrapedJob } from "#types";
import { connectionStringConfigured, getCollection, MONGODB_CONNECTION } from "./database.js";

const SEGMENT_ORDER: CoverLetterSegmentName[] = [
    "subject", "salutation", "introduction", "mainBody", "conclusion", "greetings",
];

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function coverLetterToHtml(coverLetter: StoredCoverLetter): string {
    const paras = SEGMENT_ORDER
        .flatMap(name => coverLetter[name].text ? coverLetter[name].text.split("\n\n") : [])
        .filter(p => p.trim())
        .map(p => `<p>${escapeHtml(p)}</p>`)
        .join("");
    return `<!DOCTYPE html><html><head><style>body { font-family: Arial, sans-serif; margin: 40px; } p { margin: 0 0 1em; }</style></head><body>${paras}</body></html>`;
}

export default async function getApplication(
    request: Request<{ jobDuplicateKey: string }>,
    response: Response,
): Promise<void> {
    if (!connectionStringConfigured(response)) return;

    const { jobDuplicateKey } = request.params;
    const coverLetterNotFoundError = new Error("Cover letter not found");
    const jobNotFoundError = new Error("Job not found");
    const cvNotFoundError = new Error("CV not found");

    const client = new MongoClient(MONGODB_CONNECTION!);
    try {
        await client.connect();

        const coverLetter = await getCollection<StoredCoverLetter>(client, "coverLetters").findOne({ jobDuplicateKey });
        if (!coverLetter) throw coverLetterNotFoundError;

        const job = await getCollection<StoredScrapedJob>(client, "jobs").findOne({ duplicateKey: jobDuplicateKey });
        if (!job) throw jobNotFoundError;

        const cv = await getCollection<StoredCv>(client, "cv").findOne({ jobId: job._id.toHexString() });
        if (!cv) throw cvNotFoundError;

        const uploadsDir = path.resolve("uploads/cv");
        const resolvedPath = path.resolve(cv.filePath);
        const relativePath = path.relative(uploadsDir, resolvedPath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            createErrorMessage(response, new Error("Invalid file path"), "Error retrieving application", 500);
            return;
        }

        const html = coverLetterToHtml(coverLetter);

        const browser = await puppeteer.launch({ headless: true });
        let coverLetterPdfBytes: Uint8Array;
        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "load" });
            coverLetterPdfBytes = await page.pdf({ format: "A4" });
        } finally {
            await browser.close();
        }

        const cvBytes = await readFile(resolvedPath);

        const merged = await PDFDocument.create();

        const clDoc = await PDFDocument.load(coverLetterPdfBytes);
        for (const p of await merged.copyPages(clDoc, clDoc.getPageIndices())) merged.addPage(p);

        const cvDoc = await PDFDocument.load(cvBytes);
        for (const p of await merged.copyPages(cvDoc, cvDoc.getPageIndices())) merged.addPage(p);

        const mergedBytes = await merged.save();

        response.setHeader("Content-Type", "application/pdf");
        response.setHeader("Content-Disposition", 'attachment; filename="application.pdf"');
        response.end(Buffer.from(mergedBytes));
    } catch (error) {
        createErrorMessage(
            response,
            error,
            "Error retrieving application",
            error === coverLetterNotFoundError || error === jobNotFoundError || error === cvNotFoundError ? 404 : 500,
        );
    } finally {
        await client.close();
    }
}
