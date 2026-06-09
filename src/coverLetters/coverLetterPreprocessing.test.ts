import { describe, expect, it } from "@jest/globals";
import { normalizeCoverLetterText } from "./coverLetterPreprocessing.js";

describe("normalizeCoverLetterText", () => {
    it("normalizes line breaks, trims lines, and reduces blank lines", () => {
        const input = "  Betreff: Bewerbung\r\n\r\n\r\n  Sehr geehrte Damen und Herren,  \r\n\tIch bewerbe mich.  ";

        expect(normalizeCoverLetterText(input)).toBe("Betreff: Bewerbung\n\nSehr geehrte Damen und Herren,\nIch bewerbe mich.");
    });

    it("repairs common German mojibake conservatively", () => {
        expect(normalizeCoverLetterText("Mit freundlichen GrÃ¼ÃŸen")).toBe("Mit freundlichen Grüßen");
    });
});