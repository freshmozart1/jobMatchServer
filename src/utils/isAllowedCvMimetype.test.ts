import { describe, expect, it } from '@jest/globals';
import isAllowedCvMimetype from './isAllowedCvMimetype.js';

describe('isAllowedCvMimetype', () => {
    it('accepts application/pdf', () => {
        expect(isAllowedCvMimetype('application/pdf')).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isAllowedCvMimetype('image/png')).toBe(false);
        expect(isAllowedCvMimetype('application/octet-stream')).toBe(false);
        expect(isAllowedCvMimetype('')).toBe(false);
    });
});
