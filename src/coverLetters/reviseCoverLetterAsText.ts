import type { ReviseCoverLetterAsTextRequestBody } from '#types';
import type { Request, Response } from 'express';
import { reviseCoverLetterText } from 'cover-letter-generator';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { DeadlineExceededError, withDeadline } from '../utils/withDeadline.js';

export const REVISE_COVER_LETTER_DEADLINE_MS = 60 * 1000;

function isNonEmptyStringProp(object: object, key: string): boolean {
    const value = (object as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim().length > 0;
}

function hasOptionalStringProp(object: object, key: string): boolean {
    if (!(key in object)) return true;
    const value = (object as Record<string, unknown>)[key];
    return value === undefined || typeof value === 'string';
}

export function isValidReviseCoverLetterAsTextRequestBody(
    body: unknown,
): body is ReviseCoverLetterAsTextRequestBody {
    if (typeof body !== 'object' || body === null) return false;
    if (
        !isNonEmptyStringProp(body, 'selectedText') ||
        !isNonEmptyStringProp(body, 'instruction') ||
        !isNonEmptyStringProp(body, 'coverLetterText')
    ) {
        return false;
    }

    const job = (body as Record<string, unknown>)['job'];
    return (
        typeof job === 'object' &&
        job !== null &&
        isNonEmptyStringProp(job, 'title') &&
        isNonEmptyStringProp(job, 'company') &&
        hasOptionalStringProp(job, 'location') &&
        hasOptionalStringProp(job, 'description')
    );
}

export default async function reviseCoverLetterAsText(
    request: Request<object, object, ReviseCoverLetterAsTextRequestBody>,
    response: Response,
): Promise<void> {
    if (!isValidReviseCoverLetterAsTextRequestBody(request.body)) {
        createErrorMessage(
            response,
            '',
            'Invalid request body. Please provide non-empty selectedText, instruction, coverLetterText, job.title, and job.company strings, with optional string job.location and job.description fields.',
            400,
        );
        return;
    }

    const { selectedText, instruction, coverLetterText, job } = request.body;
    if (!coverLetterText.includes(selectedText)) {
        createErrorMessage(
            response,
            '',
            'Invalid request body. selectedText must occur in coverLetterText.',
            400,
        );
        return;
    }

    try {
        const replacementText = await withDeadline(async () => {
            const replacement = await reviseCoverLetterText({
                selectedText,
                instruction,
                coverLetterText,
                job: {
                    title: job.title,
                    company: job.company,
                    description: job.description ?? '',
                    ...(job.location !== undefined
                        ? { location: job.location }
                        : {}),
                },
            });
            if (
                typeof replacement !== 'string' ||
                replacement.trim().length === 0 ||
                replacement.includes('```')
            ) {
                throw new Error(
                    'Revision helper returned an invalid replacement',
                );
            }

            return replacement;
        }, REVISE_COVER_LETTER_DEADLINE_MS);

        response.status(200).json({ replacementText });
    } catch (error) {
        if (error instanceof DeadlineExceededError) {
            createErrorMessage(
                response,
                error,
                'Cover letter revision deadline exceeded',
                504,
                'Request deadline exceeded',
            );
            return;
        }

        createErrorMessage(
            response,
            error,
            'Error revising cover letter',
            500,
            'Provider request failed',
        );
    }
}
