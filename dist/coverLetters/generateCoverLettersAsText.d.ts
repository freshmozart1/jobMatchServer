import type { ScrapedJob } from "#types";
import type { Request, Response } from "express";
type GenerateCoverLetterAsTextRequestBody = ScrapedJob & {
    coverLetterIds: string[];
};
export declare function isValidGenerateCoverLetterAsTextRequestBody(body: unknown): body is GenerateCoverLetterAsTextRequestBody;
export default function generateCoverLetterAsText(req: Request<object, object, GenerateCoverLetterAsTextRequestBody>, res: Response): Promise<void>;
export {};
//# sourceMappingURL=generateCoverLettersAsText.d.ts.map