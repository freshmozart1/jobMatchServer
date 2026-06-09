const MOJIBAKE_REPLACEMENTS = new Map<string, string>([
    ["Ã¤", "ä"],
    ["Ã„", "Ä"],
    ["Ã¶", "ö"],
    ["Ã–", "Ö"],
    ["Ã¼", "ü"],
    ["Ãœ", "Ü"],
    ["ÃŸ", "ß"],
]);

function repairCommonGermanMojibake(input: string): string {
    let repairedInput = input;

    for (const [brokenValue, replacementValue] of MOJIBAKE_REPLACEMENTS) {
        repairedInput = repairedInput.replaceAll(brokenValue, replacementValue);
    }

    return repairedInput;
}

export function normalizeCoverLetterText(input: string): string {
    return repairCommonGermanMojibake(input)
        .normalize("NFC")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.replace(/[\t ]+/g, " ").trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}