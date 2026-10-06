import type { StoredCoverLetter } from '#types';

// Keep the existing six-segment shape readable by consumers while marking the
// verbatim draft as authoritative. Replacing the record clears stale embeddings.
export function toStoredCoverLetterDraft(
    coverLetterText: string,
): Omit<StoredCoverLetter, 'jobDuplicateKey'> {
    return {
        coverLetterText,
        subject: { text: '', embedding: null },
        salutation: { text: '', embedding: null },
        introduction: { text: '', embedding: null },
        mainBody: { text: coverLetterText, embedding: null },
        conclusion: { text: '', embedding: null },
        greetings: { text: '', embedding: null },
    };
}
