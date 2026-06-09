import type { ScrapedJob } from "#types";
import type { Request, Response } from "express";
type GenerateCoverLetterAsTextRequestBody = ScrapedJob & {
    coverLetterIds: string[];
};
export default function generateCoverLetterAsText(req: Request<object, object, GenerateCoverLetterAsTextRequestBody>, res: Response): Promise<void>;
export {};
//# sourceMappingURL=generateCoverLettersAsText.d.ts.map