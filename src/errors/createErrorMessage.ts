import type { Response } from 'express';

// Public detail must be a deliberately curated string. Never inspect or coerce
// the caught value for the response; provider/driver errors belong in the log.
export function createErrorMessage(
  response: Response,
  error: unknown,
  customMessage: string,
  status: number = 500,
  publicError: string = 'Internal server error',
) {
  console.error(customMessage, error);
  response
    .status(status)
    .json({
      message: customMessage,
      error: publicError,
    });
}
