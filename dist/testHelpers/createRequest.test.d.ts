import type { Request } from "express";
import type { ParsedQs } from "qs";
export default function createRequest<Body, Query extends ParsedQs = ParsedQs>({ body, query }: {
    body?: unknown;
    query?: unknown;
}): Request<object, object, Body, Query>;
//# sourceMappingURL=createRequest.test.d.ts.map