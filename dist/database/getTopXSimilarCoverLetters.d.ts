import type { Request, Response } from "express";
type GetTopXSimilarCoverLettersRequestQuery = {
    'job-id': string;
    'x': string;
};
export default function getTopXSimilarCoverLetters(request: Request<object, object, object, GetTopXSimilarCoverLettersRequestQuery>, response: Response): Promise<void>;
export {};
//# sourceMappingURL=getTopXSimilarCoverLetters.d.ts.map