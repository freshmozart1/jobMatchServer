import { describe, expect, it } from "@jest/globals";
import { isCoverLetterTextSegments } from "./coverLetterSegmentationFallback.js";
describe("isCoverLetterTextSegments", () => {
    it("accepts a valid object with all six string fields", () => {
        expect(isCoverLetterTextSegments({
            subject: "Application as Software Engineer",
            salutation: "Dear Hiring Manager,",
            introduction: "I am excited to apply.",
            mainBody: "I have relevant experience.",
            conclusion: "I look forward to hearing from you.",
            greetings: "Best regards\nOle",
        })).toBe(true);
    });
    it("accepts an object where all fields are empty strings", () => {
        expect(isCoverLetterTextSegments({
            subject: "",
            salutation: "",
            introduction: "",
            mainBody: "",
            conclusion: "",
            greetings: "",
        })).toBe(true);
    });
    it("returns false when a field is null instead of a string", () => {
        expect(isCoverLetterTextSegments({
            subject: null,
            salutation: "",
            introduction: "",
            mainBody: "",
            conclusion: "",
            greetings: "",
        })).toBe(false);
    });
    it("returns false when any required field is missing", () => {
        const base = {
            salutation: "Dear Hiring Manager,",
            introduction: "I am excited.",
            mainBody: "I have experience.",
            conclusion: "I look forward.",
            greetings: "Best regards",
        };
        expect(isCoverLetterTextSegments(base)).toBe(false);
    });
    it("returns false for null input", () => {
        expect(isCoverLetterTextSegments(null)).toBe(false);
    });
    it("returns false for a non-object input", () => {
        expect(isCoverLetterTextSegments("a string")).toBe(false);
        expect(isCoverLetterTextSegments(42)).toBe(false);
    });
    it("returns false when a field has a numeric value", () => {
        expect(isCoverLetterTextSegments({
            subject: "",
            salutation: "",
            introduction: 123,
            mainBody: "",
            conclusion: "",
            greetings: "",
        })).toBe(false);
    });
});
//# sourceMappingURL=coverLetterSegmentationFallback.test.js.map