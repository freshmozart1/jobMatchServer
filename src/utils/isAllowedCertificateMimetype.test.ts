import { describe, expect, it } from '@jest/globals';
import isAllowedCertificateMimetype from './isAllowedCertificateMimetype.js';

describe('isAllowedCertificateMimetype', () => {
    it('accepts application/pdf', () => {
        expect(isAllowedCertificateMimetype('application/pdf')).toBe(true);
    });

    it('accepts image/jpeg', () => {
        expect(isAllowedCertificateMimetype('image/jpeg')).toBe(true);
    });

    it('accepts image/jpg', () => {
        expect(isAllowedCertificateMimetype('image/jpg')).toBe(true);
    });

    it('accepts image/png', () => {
        expect(isAllowedCertificateMimetype('image/png')).toBe(true);
    });

    it('rejects anything else', () => {
        expect(isAllowedCertificateMimetype('application/octet-stream')).toBe(
            false,
        );
        expect(isAllowedCertificateMimetype('text/plain')).toBe(false);
    });
});
