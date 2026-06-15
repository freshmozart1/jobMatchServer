import { jest } from "@jest/globals";
import type { Response } from "express";
export default function createResponse(): {
    response: Response;
    status: ReturnType<typeof jest.fn<(statusCode: number) => Response>>;
    json: ReturnType<typeof jest.fn<(body: unknown) => Response>>;
};
//# sourceMappingURL=createResponse.test.d.ts.map