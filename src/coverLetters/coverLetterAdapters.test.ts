import { describe, expect, it } from '@jest/globals';
import type { CoverLetter, CoverLetterSegments } from 'cover-letter-generator';
import type { StoredCoverLetter } from '#types';
import {
    getCoverLetterTextSegments,
    getGeneratorCoverLetterTextSegments,
    reconstructCoverLetterText,
    toGeneratorCoverLetter,
} from './coverLetterAdapters.js';

const storedCoverLetter = {
    subject: { text: 'Subject: Application', embedding: [0.1] },
    salutation: { text: 'Dear Hiring Manager,', embedding: [0.2] },
    introduction: { text: 'I am excited to apply.', embedding: [0.3] },
    mainBody: { text: 'I build software.', embedding: [0.4] },
    conclusion: {
        text: 'I look forward to speaking with you.',
        embedding: [0.5],
    },
    greetings: { text: 'Best regards\nOle', embedding: [0.6] },
    jobDuplicateKey: 'test-key-1',
} satisfies StoredCoverLetter;

describe('getCoverLetterTextSegments', () => {
    it('extracts the text of each segment from a StoredCoverLetter', () => {
        expect(getCoverLetterTextSegments(storedCoverLetter)).toEqual({
            subject: 'Subject: Application',
            salutation: 'Dear Hiring Manager,',
            introduction: 'I am excited to apply.',
            mainBody: 'I build software.',
            conclusion: 'I look forward to speaking with you.',
            greetings: 'Best regards\nOle',
        });
    });
});

describe('reconstructCoverLetterText', () => {
    it('joins non-empty segments in order with blank lines between them', () => {
        const segments = {
            subject: 'Subject: Application',
            salutation: 'Dear Hiring Manager,',
            introduction: 'I am excited to apply.',
            mainBody: 'I build software.',
            conclusion: 'I look forward to speaking with you.',
            greetings: 'Best regards\nOle',
        } satisfies CoverLetterSegments;

        expect(reconstructCoverLetterText(segments)).toBe(
            'Subject: Application\n\nDear Hiring Manager,\n\nI am excited to apply.\n\nI build software.\n\nI look forward to speaking with you.\n\nBest regards\nOle',
        );
    });

    it('skips empty and whitespace-only segments', () => {
        const segments = {
            subject: '',
            salutation: 'Dear Hiring Manager,',
            introduction: 'I am excited to apply.',
            mainBody: '   ',
            conclusion: 'I look forward to speaking with you.',
            greetings: '',
        } satisfies CoverLetterSegments;

        expect(reconstructCoverLetterText(segments)).toBe(
            'Dear Hiring Manager,\n\nI am excited to apply.\n\nI look forward to speaking with you.',
        );
    });
});

describe('toGeneratorCoverLetter', () => {
    it('maps a StoredCoverLetter to the package CoverLetter shape, keeping embeddings', () => {
        expect(toGeneratorCoverLetter(storedCoverLetter)).toEqual({
            subject: { text: 'Subject: Application', embedding: [0.1] },
            salutation: { text: 'Dear Hiring Manager,', embedding: [0.2] },
            introduction: { text: 'I am excited to apply.', embedding: [0.3] },
            mainBody: { text: 'I build software.', embedding: [0.4] },
            conclusion: {
                text: 'I look forward to speaking with you.',
                embedding: [0.5],
            },
            greetings: { text: 'Best regards\nOle', embedding: [0.6] },
        });
    });

    it('omits the embedding field instead of using null when a segment has no embedding', () => {
        const storedCoverLetterWithoutSubjectEmbedding = {
            ...storedCoverLetter,
            subject: { text: 'Subject: Application', embedding: null },
        } satisfies StoredCoverLetter;

        const result = toGeneratorCoverLetter(
            storedCoverLetterWithoutSubjectEmbedding,
        );

        expect(result.subject).toEqual({ text: 'Subject: Application' });
        expect('embedding' in result.subject).toBe(false);
    });
});

describe('getGeneratorCoverLetterTextSegments', () => {
    it('extracts the text of each segment from a package CoverLetter', () => {
        const coverLetter = {
            subject: { text: 'Subject: Application', embedding: [0.1] },
            salutation: { text: 'Dear Hiring Manager,', embedding: [0.2] },
            introduction: { text: 'I am excited to apply.', embedding: [0.3] },
            mainBody: { text: 'I build software.', embedding: [0.4] },
            conclusion: {
                text: 'I look forward to speaking with you.',
                embedding: [0.5],
            },
            greetings: { text: 'Best regards\nOle' },
        } satisfies CoverLetter;

        expect(getGeneratorCoverLetterTextSegments(coverLetter)).toEqual({
            subject: 'Subject: Application',
            salutation: 'Dear Hiring Manager,',
            introduction: 'I am excited to apply.',
            mainBody: 'I build software.',
            conclusion: 'I look forward to speaking with you.',
            greetings: 'Best regards\nOle',
        });
    });
});
