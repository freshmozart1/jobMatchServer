import type { CoverLetterTextSegments } from "#types";
import OpenAI from "openai";
import { normalizeCoverLetterText } from "./coverLetterPreprocessing.js";

const FALLBACK_MODEL = "gpt-5.5";

const coverLetterSegmentsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["subject", "salutation", "introduction", "mainBody", "conclusion", "greetings"],
    properties: {
        subject: { type: "string" },
        salutation: { type: "string" },
        introduction: { type: "string" },
        mainBody: { type: "string" },
        conclusion: { type: "string" },
        greetings: { type: "string" },
    },
} satisfies Record<string, unknown>;

function isCoverLetterTextSegments(value: unknown): value is CoverLetterTextSegments {
    return typeof value === "object"
        && value !== null
        && "subject" in value
        && typeof value.subject === "string"
        && "salutation" in value
        && typeof value.salutation === "string"
        && "introduction" in value
        && typeof value.introduction === "string"
        && "mainBody" in value
        && typeof value.mainBody === "string"
        && "conclusion" in value
        && typeof value.conclusion === "string"
        && "greetings" in value
        && typeof value.greetings === "string";
}

function normalizeForContainment(input: string): string {
    return normalizeCoverLetterText(input).replace(/\s+/g, " ").trim();
}

function validateSourcePreservingSegments(sourceText: string, segments: CoverLetterTextSegments): boolean {
    const normalizedSourceText = normalizeForContainment(sourceText);

    return Object.values(segments).every((segmentText) => {
        const normalizedSegmentText = normalizeForContainment(segmentText);
        return normalizedSegmentText.length === 0 || normalizedSourceText.includes(normalizedSegmentText);
    });
}

export async function segmentCoverLetterWithLlmFallback(normalizedCoverLetterText: string): Promise<CoverLetterTextSegments> {
    const client = new OpenAI();
    const response = await client.responses.create({
        model: FALLBACK_MODEL,
        instructions: "Segment the cover letter into the requested fields. Preserve the original wording exactly. Do not summarize, rewrite, translate, or invent content. Return empty strings for sections that are absent.",
        input: normalizedCoverLetterText,
        text: {
            format: {
                type: "json_schema",
                name: "cover_letter_segments",
                strict: true,
                schema: coverLetterSegmentsSchema,
            },
        },
    });
    const parsedOutput: unknown = JSON.parse(response.output_text);

    if (!isCoverLetterTextSegments(parsedOutput)) {
        throw new Error("OpenAI did not return valid cover letter segments");
    }

    const normalizedSegments = {
        subject: normalizeCoverLetterText(parsedOutput.subject),
        salutation: normalizeCoverLetterText(parsedOutput.salutation),
        introduction: normalizeCoverLetterText(parsedOutput.introduction),
        mainBody: normalizeCoverLetterText(parsedOutput.mainBody),
        conclusion: normalizeCoverLetterText(parsedOutput.conclusion),
        greetings: normalizeCoverLetterText(parsedOutput.greetings),
    } satisfies CoverLetterTextSegments;

    if (!validateSourcePreservingSegments(normalizedCoverLetterText, normalizedSegments)) {
        throw new Error("OpenAI returned cover letter segments that are not present in the source text");
    }

    return normalizedSegments;
}