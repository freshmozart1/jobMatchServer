// fallow-ignore-file security-sink
// fetch() target is not attacker-controlled: tokenServiceUrl defaults to
// process.env['TOKEN_SERVICE_URL'], set once at server startup from the
// local Python token-service subprocess's own stdout (see src/index.ts).
// The only caller (calculateTokens.ts) never overrides it. Verified 2026-07.
import type { CalculateTokensRequestBody } from '#types';

export default async function fetchTokens(
  text: CalculateTokensRequestBody['text'],
  model?: CalculateTokensRequestBody['model'],
  tokenServiceUrl = process.env['TOKEN_SERVICE_URL'],
): Promise<globalThis.Response> {
  if (!tokenServiceUrl)
    throw new Error(
      'Token service URL is not defined in environment variables.',
    );
  return fetch(tokenServiceUrl + '/count', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model,
    }),
  });
}
