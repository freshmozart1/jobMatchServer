import type { Response } from 'express';

export function createErrorMessage(
  response: Response,
  error: unknown,
  customMessage: string,
  status: number = 500,
) {
  console.error(customMessage, error);
  response
    .status(status)
    .json({
      message: customMessage,
      error: error instanceof Error ? error.message : String(error),
    });
}
