import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from '@jest/globals';
import type { Request } from 'express';
import * as fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { PDFDocument } from 'pdf-lib';
import type { StoredCertificate } from '#types';
import { certificateImages } from '../testHelpers/certificateImages.test.js';
import { getPdfImageGeometry } from '../testHelpers/pdfImageGeometry.test.js';
import {
    getCollection,
    connectionStringConfigured,
    mockLocalDatabaseModule,
} from '../testMockModules/localDatabase.test.js';
import {
    connect,
    close,
    mockMongoDbModule,
} from '../testMockModules/mongodb.test.js';
import createResponse from '../testHelpers/createResponse.test.js';
import mockResponseWithHeaders from '../testHelpers/mockResponseWithHeaders.test.js';

const readFile = jest.fn<typeof fs.readFile>();
jest.unstable_mockModule('fs/promises', () => ({ ...fs, readFile }));
const render = jest.fn<() => Promise<Uint8Array>>();
jest.unstable_mockModule('#database/coverLetterPdf.js', () => ({
    coverLetterToHtml: () => '<html>synthetic cover letter</html>',
    renderCoverLetterPdf: render,
    CoverLetterOverflowError: class extends Error {},
}));
mockMongoDbModule();
mockLocalDatabaseModule();
const { default: getApplication } = await import('./getApplication.js');
const certificates = jest.fn<() => Promise<StoredCertificate[]>>();
let createdPaths: string[];

async function pdfBytes(sizes: [number, number][]): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    sizes.forEach((size) => document.addPage(size));
    return document.save();
}
async function saveFile(directory: string, bytes: Uint8Array): Promise<string> {
    const filePath = path.resolve(
        directory,
        `image-proportions-${randomUUID()}`,
    );
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filePath, bytes);
    createdPaths.push(filePath);
    return filePath;
}
function certificate(filePath: string, mimeType: string): StoredCertificate {
    return {
        jobId: 'job-id',
        filePath,
        mimeType,
        originalName: 'synthetic certificate',
    };
}
async function application(): Promise<PDFDocument> {
    const { response, status } = createResponse();
    const { end } = mockResponseWithHeaders(response);
    await getApplication(
        { params: { jobDuplicateKey: 'job' } } as Request<{
            jobDuplicateKey: string;
        }>,
        response,
    );
    expect(status).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    return PDFDocument.load(end.mock.calls[0]![0]);
}

beforeEach(async () => {
    jest.clearAllMocks();
    createdPaths = [];
    connectionStringConfigured.mockReturnValue(true);
    connect.mockResolvedValue();
    close.mockResolvedValue();
    readFile.mockImplementation(fs.readFile);
    render.mockResolvedValue(await pdfBytes([[595.28, 841.89]]));
    const cvPath = await saveFile('uploads/cv', await pdfBytes([[300, 500]]));
    certificates.mockResolvedValue([]);
    getCollection.mockImplementation((_client, name) => {
        if (name === 'jobs')
            return {
                findOne: async () => ({ _id: { toHexString: () => 'job-id' } }),
            };
        if (name === 'cv')
            return {
                findOne: async () => ({ jobId: 'job-id', filePath: cvPath }),
            };
        if (name === 'certificates')
            return { find: () => ({ toArray: certificates }) };
        return { findOne: async () => ({}) };
    });
});
afterEach(async () => {
    await Promise.all(
        createdPaths.map((filePath) => fs.rm(filePath, { force: true })),
    );
});

describe('certificate image proportions in actual application PDF bytes', () => {
    it.each(certificateImages)(
        'contains and centers a $shape $format image without distortion',
        async (fixture) => {
            const filePath = await saveFile(
                'uploads/certificates',
                Buffer.from(fixture.base64, 'base64'),
            );
            certificates.mockResolvedValue([
                certificate(filePath, `image/${fixture.format}`),
            ]);
            const document = await application();
            expect(document.getPageCount()).toBe(3);
            const geometry = getPdfImageGeometry(document.getPages()[2]!);
            expect(geometry.imageWidth).toBe(fixture.width);
            expect(geometry.imageHeight).toBe(fixture.height);
            expect([geometry.pageWidth, geometry.pageHeight]).toEqual(
                fixture.shape === 'landscape'
                    ? [841.89, 595.28]
                    : [595.28, 841.89],
            );
            expect(geometry.width / geometry.height).toBeCloseTo(
                fixture.width / fixture.height,
                10,
            );
            expect(geometry.matrix[1]).toBe(0);
            expect(geometry.matrix[2]).toBe(0);
            expect(geometry.x).toBeGreaterThanOrEqual(36 - 1e-8);
            expect(geometry.y).toBeGreaterThanOrEqual(36 - 1e-8);
            expect(geometry.x + geometry.width).toBeLessThanOrEqual(
                geometry.pageWidth - 36 + 1e-8,
            );
            expect(geometry.y + geometry.height).toBeLessThanOrEqual(
                geometry.pageHeight - 36 + 1e-8,
            );
            expect(geometry.x * 2 + geometry.width).toBeCloseTo(
                geometry.pageWidth,
                10,
            );
            expect(geometry.y * 2 + geometry.height).toBeCloseTo(
                geometry.pageHeight,
                10,
            );
            expect(Math.min(geometry.x, geometry.y)).toBeCloseTo(36, 10);
        },
    );

    it('copies PDF certificate pages unchanged and skips corrupt or unsafe images without blank pages', async () => {
        const originalPdf = await saveFile(
            'uploads/certificates',
            await pdfBytes([
                [420, 300],
                [210, 400],
            ]),
        );
        const invalidPng = await saveFile(
            'uploads/certificates',
            Buffer.from('not a PNG'),
        );
        const invalidJpeg = await saveFile(
            'uploads/certificates',
            Buffer.from('not a JPEG'),
        );
        const unsafeImage = await saveFile(
            'uploads/cv',
            Buffer.from(certificateImages[0].base64, 'base64'),
        );
        certificates.mockResolvedValue([
            certificate(invalidPng, 'image/png'),
            certificate(originalPdf, 'application/pdf'),
            certificate(invalidJpeg, 'image/jpeg'),
            certificate(unsafeImage, 'image/jpeg'),
        ]);
        const document = await application();
        expect(document.getPageCount()).toBe(4);
        expect(
            document
                .getPages()
                .slice(2)
                .map((page) => [page.getWidth(), page.getHeight()]),
        ).toEqual([
            [420, 300],
            [210, 400],
        ]);
        expect(readFile).not.toHaveBeenCalledWith(unsafeImage);
    });
});
