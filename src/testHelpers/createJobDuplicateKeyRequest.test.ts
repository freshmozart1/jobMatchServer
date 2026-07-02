import type { Request } from 'express';
import createRequest from './createRequest.test.js';

export default function createJobDuplicateKeyRequest(
  jobDuplicateKey: string,
): Request<{ jobDuplicateKey: string }, object, object, never> {
  return createRequest<object, never, { jobDuplicateKey: string }>({
    params: { jobDuplicateKey },
  });
}
