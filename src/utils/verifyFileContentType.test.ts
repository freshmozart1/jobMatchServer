import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
    fileContentMatchesMimetype,
    matchesFileSignature,
} from './verifyFileContentType.js';

describe('matchesFileSignature', () => {
    it('accepts a PDF signature for application/pdf', () => {
        expect(
            matchesFileSignature(
                Buffer.from('%PDF-1.7\n%%EOF'),
                'application/pdf',
            ),
        ).toBe(true);
    });

    it('accepts a JPEG signature for image/jpeg', () => {
        expect(
            matchesFileSignature(
                Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
                'image/jpeg',
            ),
        ).toBe(true);
    });

    it('accepts a JPEG signature for image/jpg', () => {
        expect(
            matchesFileSignature(
                Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
                'image/jpg',
            ),
        ).toBe(true);
    });

    it('accepts a PNG signature for image/png', () => {
        expect(
            matchesFileSignature(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                'image/png',
            ),
        ).toBe(true);
    });

    it('rejects a buffer with the wrong bytes', () => {
        expect(
            matchesFileSignature(Buffer.from('not a pdf'), 'application/pdf'),
        ).toBe(false);
    });

    it('rejects a buffer shorter than the required signature', () => {
        expect(
            matchesFileSignature(Buffer.from('%PD'), 'application/pdf'),
        ).toBe(false);
    });

    it('rejects an empty buffer', () => {
        expect(matchesFileSignature(Buffer.alloc(0), 'application/pdf')).toBe(
            false,
        );
    });

    it('rejects an unsupported mimetype', () => {
        expect(
            matchesFileSignature(
                Buffer.from('%PDF-'),
                'application/octet-stream',
            ),
        ).toBe(false);
    });
});

describe('fileContentMatchesMimetype', () => {
    let tmpDir: string | undefined;

    afterEach(async () => {
        if (tmpDir) {
            await rm(tmpDir, { recursive: true, force: true });
            tmpDir = undefined;
        }
    });

    it('resolves true for a file starting with the PDF signature', async () => {
        tmpDir = await mkdtemp(path.join(tmpdir(), 'verify-file-content-'));
        const filePath = path.join(tmpDir, 'file.pdf');
        await writeFile(filePath, Buffer.from('%PDF-1.7\n%%EOF'));

        await expect(
            fileContentMatchesMimetype(filePath, 'application/pdf'),
        ).resolves.toBe(true);
    });

    it('resolves false for a file with the wrong leading bytes', async () => {
        tmpDir = await mkdtemp(path.join(tmpdir(), 'verify-file-content-'));
        const filePath = path.join(tmpDir, 'file.pdf');
        await writeFile(filePath, Buffer.from('not actually a pdf'));

        await expect(
            fileContentMatchesMimetype(filePath, 'application/pdf'),
        ).resolves.toBe(false);
    });
});
