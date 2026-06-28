import type { Request, Response } from "express";
import { readFileSync } from "fs";
import { readFile } from "fs/promises";
import { MongoClient, ObjectId } from "mongodb";
import path from "path";
import { PDFDocument } from "pdf-lib";
import puppeteer from "puppeteer";
import type { Browser } from "puppeteer";
import { createErrorMessage } from "../errors/createErrorMessage.js";
import type {
  CoverLetterSegmentName,
  StoredCertificate,
  StoredCoverLetter,
  StoredCv,
  StoredScrapedJob,
  StoredUser,
} from "#types";
import {
  connectionStringConfigured,
  getCollection,
  MONGODB_CONNECTION,
} from "./database.js";

const USER_ID = new ObjectId("6a3d03b1dba1b11cee01161c");

const BODY_SEGMENT_ORDER: CoverLetterSegmentName[] = [
  "salutation",
  "introduction",
  "mainBody",
  "conclusion",
  "greetings",
];

const coverLetterTemplate = readFileSync(
  new URL("./coverLetter.html", import.meta.url),
  "utf-8",
);

const BROWSER_RENDERABLE_IMAGE = /^image\/(jpeg|jpg|png|gif|webp)$/;

function isPathInside(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir);
  const relative = path.relative(base, path.resolve(candidate));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function imageToPdfBytes(
  browser: Browser,
  bytes: Buffer,
  mimeType: string,
): Promise<Uint8Array> {
  const dataUri = `data:${mimeType};base64,${bytes.toString("base64")}`;
  const html =
    "<!doctype html><html><head><style>" +
    "*{margin:0;padding:0}img{display:block;width:100%;height:auto}" +
    "</style></head><body>" +
    `<img src="${dataUri}"></body></html>`;
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4" });
  } finally {
    await page.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function coverLetterToHtml(
  coverLetter: StoredCoverLetter,
  job: StoredScrapedJob,
  user: StoredUser,
): string {
  const date = new Date().toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const bodyParas = BODY_SEGMENT_ORDER.flatMap((name) =>
    coverLetter[name].text ? coverLetter[name].text.split("\n\n") : [],
  )
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return coverLetterTemplate
    .replace(/\{\{userName\}\}/g, () => escapeHtml(user.name))
    .replace(/\{\{userStreetAddress\}\}/g, () =>
      escapeHtml(user.address.streetAddress),
    )
    .replace(/\{\{userPostalCode\}\}/g, () =>
      escapeHtml(user.address.postalCode),
    )
    .replace(/\{\{userCity\}\}/g, () => escapeHtml(user.address.city))
    .replace(/\{\{userTel\}\}/g, () => escapeHtml(user.tel))
    .replace(/\{\{userEmail\}\}/g, () => escapeHtml(user.email))
    .replace(/\{\{jobCompany\}\}/g, () => escapeHtml(job.company))
    .replace(/\{\{jobStreetAddress\}\}/g, () =>
      escapeHtml(job.companyAddress.streetAddress),
    )
    .replace(/\{\{jobPostalCode\}\}/g, () =>
      escapeHtml(job.companyAddress.postalCode),
    )
    .replace(/\{\{jobCity\}\}/g, () => escapeHtml(job.companyAddress.city))
    .replace(/\{\{date\}\}/g, () => escapeHtml(date))
    .replace(/\{\{subject\}\}/g, () => escapeHtml(coverLetter.subject.text))
    .replace(/\{\{bodyParas\}\}/g, () => bodyParas);
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

    const coverLetter = await getCollection<StoredCoverLetter>(
      client,
      "coverLetters",
    ).findOne({ jobDuplicateKey });
    if (!coverLetter) throw coverLetterNotFoundError;

    const job = await getCollection<StoredScrapedJob>(client, "jobs").findOne({
      duplicateKey: jobDuplicateKey,
    });
    if (!job) throw jobNotFoundError;

    const cv = await getCollection<StoredCv>(client, "cv").findOne({
      jobId: job._id.toHexString(),
    });
    if (!cv) throw cvNotFoundError;

    const user = await getCollection<StoredUser>(client, "users").findOne({
      _id: USER_ID,
    });
    if (!user) throw new Error("User not found");

    const resolvedPath = path.resolve(cv.filePath);
    if (!isPathInside("uploads/cv", cv.filePath)) {
      createErrorMessage(
        response,
        new Error("Invalid file path"),
        "Error retrieving application",
        500,
      );
      return;
    }

    // Certificates are optional: a job without certificates still produces a
    // valid application PDF. Any certificate that cannot be embedded (unsafe
    // path, non-renderable image, or corrupt file) is skipped, never fatal.
    const certificates = await getCollection<StoredCertificate>(
      client,
      "certificates",
    )
      .find({ jobId: job._id.toHexString() })
      .toArray();
    const safeCertificates = certificates.filter((certificate) =>
      isPathInside("uploads/certificates", certificate.filePath),
    );

    const html = coverLetterToHtml(coverLetter, job, user);

    const browser = await puppeteer.launch({ headless: true });
    let coverLetterPdfBytes: Uint8Array;
    const certificatePdfByteArrays: Uint8Array[] = [];
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      coverLetterPdfBytes = await page.pdf({ format: "A4" });

      for (const certificate of safeCertificates) {
        try {
          const certificateBytes = await readFile(
            path.resolve(certificate.filePath),
          );
          if (certificate.mimeType === "application/pdf") {
            certificatePdfByteArrays.push(certificateBytes);
          } else if (BROWSER_RENDERABLE_IMAGE.test(certificate.mimeType)) {
            certificatePdfByteArrays.push(
              await imageToPdfBytes(
                browser,
                certificateBytes,
                certificate.mimeType,
              ),
            );
          }
          // Other formats (e.g. tiff, bmp) are skipped silently.
        } catch {
          // A single unreadable/corrupt certificate must not break the
          // application; skip it and continue.
          continue;
        }
      }
    } finally {
      await browser.close();
    }

    const cvBytes = await readFile(resolvedPath);

    const merged = await PDFDocument.create();

    const clDoc = await PDFDocument.load(coverLetterPdfBytes);
    for (const p of await merged.copyPages(clDoc, clDoc.getPageIndices()))
      merged.addPage(p);

    const cvDoc = await PDFDocument.load(cvBytes);
    for (const p of await merged.copyPages(cvDoc, cvDoc.getPageIndices()))
      merged.addPage(p);

    for (const certificateBytes of certificatePdfByteArrays) {
      try {
        const certificateDoc = await PDFDocument.load(certificateBytes);
        for (const p of await merged.copyPages(
          certificateDoc,
          certificateDoc.getPageIndices(),
        ))
          merged.addPage(p);
      } catch {
        // Skip a certificate whose bytes fail to load as a PDF.
        continue;
      }
    }

    const mergedBytes = await merged.save();

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="application.pdf"',
    );
    response.end(Buffer.from(mergedBytes));
  } catch (error) {
    createErrorMessage(
      response,
      error,
      "Error retrieving application",
      error === coverLetterNotFoundError ||
        error === jobNotFoundError ||
        error === cvNotFoundError
        ? 404
        : 500,
    );
  } finally {
    await client.close();
  }
}
