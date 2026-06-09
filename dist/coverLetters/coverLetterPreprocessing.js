const MOJIBAKE_REPLACEMENTS = new Map([
    ["Ã¤", "ä"],
    ["Ã„", "Ä"],
    ["Ã¶", "ö"],
    ["Ã–", "Ö"],
    ["Ã¼", "ü"],
    ["Ãœ", "Ü"],
    ["ÃŸ", "ß"],
]);
function repairCommonGermanMojibake(input) {
    let repairedInput = input;
    for (const [brokenValue, replacementValue] of MOJIBAKE_REPLACEMENTS) {
        repairedInput = repairedInput.replaceAll(brokenValue, replacementValue);
    }
    return repairedInput;
}
export function normalizeCoverLetterText(input) {
    return repairCommonGermanMojibake(input)
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[\t ]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
//# sourceMappingURL=coverLetterPreprocessing.js.map