import { describe, expect, it } from "@jest/globals";
import { isValidGenerateCoverLetterAsTextRequestBody } from "./generateCoverLettersAsText.js";
const validObjectId = "507f1f77bcf86cd799439011";
const validBase = {
    sourceHostname: "www.linkedin.com",
    sourceUrl: "https://www.linkedin.com/jobs/view/1234567/",
    title: "Software Engineer",
    company: "Acme Corp",
    location: "Berlin",
    descriptionText: "We are looking for an engineer.",
    postedAt: "2024-01-01",
    scrapedAt: new Date().toISOString(),
    tags: ["Full-time"],
    duplicateKey: "linkedin:1234567",
    coverLetterIds: [validObjectId],
};
describe("isValidGenerateCoverLetterAsTextRequestBody", () => {
    it("accepts a complete valid body", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody(validBase)).toBe(true);
    });
    it("accepts a body with optional fields absent", () => {
        const { location, descriptionText, postedAt, tags, ...rest } = validBase;
        void location;
        void descriptionText;
        void postedAt;
        void tags;
        expect(isValidGenerateCoverLetterAsTextRequestBody({
            ...rest,
            location: undefined,
            descriptionText: undefined,
            postedAt: undefined,
            tags: undefined,
        })).toBe(true);
    });
    it("accepts multiple valid coverLetterIds", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody({
            ...validBase,
            coverLetterIds: [validObjectId, "aabbccddeeff001122334455"],
        })).toBe(true);
    });
    it("returns false when body is null", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody(null)).toBe(false);
    });
    it("returns false when body is not an object", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody("string")).toBe(false);
    });
    it("returns false when sourceHostname is missing", () => {
        const { sourceHostname, ...rest } = validBase;
        void sourceHostname;
        expect(isValidGenerateCoverLetterAsTextRequestBody(rest)).toBe(false);
    });
    it("returns false when title is not a string", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody({ ...validBase, title: 123 })).toBe(false);
    });
    it("returns false when tags contains a non-string element", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody({ ...validBase, tags: ["Full-time", 42] })).toBe(false);
    });
    it("returns false when a coverLetterId is not a valid 24-hex ObjectId", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody({
            ...validBase,
            coverLetterIds: ["not-an-objectid"],
        })).toBe(false);
    });
    it("returns false when coverLetterIds is not an array", () => {
        expect(isValidGenerateCoverLetterAsTextRequestBody({
            ...validBase,
            coverLetterIds: validObjectId,
        })).toBe(false);
    });
    it("returns false when coverLetterIds is missing", () => {
        const { coverLetterIds, ...rest } = validBase;
        void coverLetterIds;
        expect(isValidGenerateCoverLetterAsTextRequestBody(rest)).toBe(false);
    });
    it("returns false when scrapedAt is missing", () => {
        const { scrapedAt, ...rest } = validBase;
        void scrapedAt;
        expect(isValidGenerateCoverLetterAsTextRequestBody(rest)).toBe(false);
    });
});
//# sourceMappingURL=generateCoverLettersAsText.test.js.map