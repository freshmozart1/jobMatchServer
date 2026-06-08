import type { Request, Response } from "express";
type CoverLetterAsTextRequestBody = {
    coverLetterText: string;
};
export default function uploadCoverLetterAsText(request: Request<object, object, CoverLetterAsTextRequestBody>, response: Response): Promise<void>;
export {};
//# sourceMappingURL=uploadCoverLetterAsText.d.ts.map