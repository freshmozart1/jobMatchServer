import { jest } from '@jest/globals';
import type { Response } from 'express';

export default function createResponse(): {
  response: Response;
  status: ReturnType<typeof jest.fn<(statusCode: number) => Response>>;
  json: ReturnType<typeof jest.fn<(body: unknown) => Response>>;
} {
  const status = jest.fn<(statusCode: number) => Response>();
  const json = jest.fn<(body: unknown) => Response>();
  const response = { status, json } as unknown as Response;

  status.mockReturnValue(response);
  json.mockReturnValue(response);

  return { response, status, json };
}
