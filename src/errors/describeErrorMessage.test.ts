import { describe, expect, it } from '@jest/globals';
import { describeErrorMessage } from './describeErrorMessage.js';

const FALLBACK = 'Fallback message';

describe('describeErrorMessage', () => {
    it('returns an Error message', () => {
        expect(describeErrorMessage(new Error('boom'), FALLBACK)).toBe('boom');
    });

    it('falls back to the Error name when the message is empty', () => {
        expect(describeErrorMessage(new Error(''), FALLBACK)).toBe('Error');
    });

    it('reads only the message of an error-like object', () => {
        expect(
            describeErrorMessage(
                { message: 'boom', code: 'E_BOOM', secret: 'internal' },
                FALLBACK,
            ),
        ).toBe('boom');
    });

    it('treats a throwing message getter as absent', () => {
        const hostile = {
            get message(): string {
                throw new Error('getter exploded');
            },
            toString(): string {
                return 'hostile value';
            },
        };

        expect(describeErrorMessage(hostile, FALLBACK)).toBe('hostile value');
    });

    it('stringifies a primitive rejection value', () => {
        expect(describeErrorMessage('socket hang up', FALLBACK)).toBe(
            'socket hang up',
        );
    });

    it('returns the fallback when String() throws or yields an empty string', () => {
        expect(describeErrorMessage(Object.create(null), FALLBACK)).toBe(
            FALLBACK,
        );
        expect(describeErrorMessage('', FALLBACK)).toBe(FALLBACK);
    });
});
