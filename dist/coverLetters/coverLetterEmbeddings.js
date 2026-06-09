import { embedMany } from "../embeddings/embeddings.js";
import { COVER_LETTER_SEGMENT_NAMES } from "./coverLetterSegmentation.js";
function createStoredCoverLetterSegment(text, embedding) {
    return { text, embedding };
}
export async function createStoredCoverLetterFromTextSegments(segments) {
    const segmentNamesWithText = COVER_LETTER_SEGMENT_NAMES.filter((segmentName) => segments[segmentName].trim().length > 0);
    const embeddings = segmentNamesWithText.length > 0
        ? await embedMany(segmentNamesWithText.map((segmentName) => segments[segmentName]))
        : [];
    const embeddingsBySegmentName = new Map();
    segmentNamesWithText.forEach((segmentName, index) => {
        const embedding = embeddings[index];
        if (!embedding) {
            throw new Error(`Missing embedding for cover letter segment: ${segmentName}`);
        }
        embeddingsBySegmentName.set(segmentName, embedding);
    });
    return {
        subject: createStoredCoverLetterSegment(segments.subject, embeddingsBySegmentName.get("subject") ?? null),
        salutation: createStoredCoverLetterSegment(segments.salutation, embeddingsBySegmentName.get("salutation") ?? null),
        introduction: createStoredCoverLetterSegment(segments.introduction, embeddingsBySegmentName.get("introduction") ?? null),
        mainBody: createStoredCoverLetterSegment(segments.mainBody, embeddingsBySegmentName.get("mainBody") ?? null),
        conclusion: createStoredCoverLetterSegment(segments.conclusion, embeddingsBySegmentName.get("conclusion") ?? null),
        greetings: createStoredCoverLetterSegment(segments.greetings, embeddingsBySegmentName.get("greetings") ?? null),
    };
}
//# sourceMappingURL=coverLetterEmbeddings.js.map