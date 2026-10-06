import type { Response } from 'express';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { CoverLetterOverflowError } from './coverLetterPdf.js';
import { UserProfileMissingError } from './userProfile.js';

export function handleKnownCoverLetterPdfError(
    response: Response,
    error: unknown,
): boolean {
    if (error instanceof UserProfileMissingError) {
        createErrorMessage(response, error, error.message, 409, error.message);
        return true;
    }
    if (error instanceof CoverLetterOverflowError) {
        createErrorMessage(response, error, error.message, 422, error.message);
        return true;
    }
    return false;
}
