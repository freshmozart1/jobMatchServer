import type { Request } from 'express';
import type { ParsedQs } from 'qs';

export default function createRequest<
  Body,
  Query extends ParsedQs = ParsedQs,
  Params = Record<string, string>,
>({
  body,
  query,
  params,
}: {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}): Request<Params, object, Body, Query> {
  if (body) return { body, params } as Request<Params, object, Body, Query>;
  return { query, params } as Request<Params, object, Body, Query>;
}
