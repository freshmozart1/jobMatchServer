import type { Request } from "express";
import type { ParsedQs } from "qs";

export default function createRequest<Body,Query extends ParsedQs = ParsedQs>({body, query}: {body?: unknown, query?: unknown}): Request<object, object, Body, Query> {
    if (body) return { body } as Request<object, object, Body, Query>;
    return { query } as Request<object, object, Body, Query>;
}