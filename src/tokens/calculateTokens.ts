import type { Request, Response } from 'express';
import type { CalculateTokensRequestBody } from '#types';
import fetchTokens from './fetchTokens.js';

export default async function countTokens(
  request: Request<object, object, CalculateTokensRequestBody>,
  response: Response,
): Promise<void> {
  let tokenServiceResponse: globalThis.Response;
  try {
    tokenServiceResponse = await fetchTokens(
      request.body.text,
      request.body.model,
    );
  } catch (error) {
    response
      .status(500)
      .json({
        error: 'Error connecting to token service.',
        details: error instanceof Error ? error.message : String(error),
      });
    return;
  }

  if (!tokenServiceResponse.ok) {
    response.status(500).json({ error: 'Failed to calculate tokens.' });
    return;
  }

  const tokenCount = await tokenServiceResponse.json();
  response.status(200).json({ tokenCount });
}
