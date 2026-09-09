import type { Response } from 'express';

export function createErrorMessage(
  response: Response,
  error: unknown,
  customMessage: string,
  status: number = 500,
  publicError: unknown = error,
) {
  console.error(customMessage, error);
  response
    .status(status)
    .json({
      message: customMessage,
      error:
        publicError instanceof Error
          ? publicError.message
          : String(publicError),
    });
}
