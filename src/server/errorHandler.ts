import type { NextFunction, Request, Response } from 'express';
import { createErrorMessage } from '../errors/createErrorMessage.js';

function clientErrorStatus(error: unknown): number | undefined {
    try {
        // http-errors can put parser status on the immediate prototype. Read
        // data descriptors only, never a caught value's potentially hostile getter.
        const descriptor =
            Object.getOwnPropertyDescriptor(error, 'status') ??
            Object.getOwnPropertyDescriptor(
                Object.getPrototypeOf(error),
                'status',
            );
        const status = descriptor?.value as unknown;
        return typeof status === 'number' &&
            Number.isInteger(status) &&
            status >= 400 &&
            status < 500
            ? status
            : undefined;
    } catch {
        return undefined;
    }
}

export default function handleUnhandledError(
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
): void {
    if (response.headersSent) {
        // Express closes a started response; a JSON rewrite would corrupt SSE/PDF.
        next(error);
        return;
    }

    const status = clientErrorStatus(error);
    if (status !== undefined) {
        createErrorMessage(
            response,
            error,
            'Invalid request',
            status,
            'Invalid request',
        );
        return;
    }
    createErrorMessage(response, error, 'Unexpected server error');
}
