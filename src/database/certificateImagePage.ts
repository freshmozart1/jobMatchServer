import type { PDFDocument, PDFImage } from 'pdf-lib';

const A4_SHORT_SIDE = 595.28;
const A4_LONG_SIDE = 841.89;
const IMAGE_MARGIN = 36; // Half an inch on every edge, in PDF points.

export function addCertificateImagePage(
    document: PDFDocument,
    image: PDFImage,
): void {
    if (
        ![image.width, image.height].every(
            (dimension) => Number.isFinite(dimension) && dimension > 0,
        )
    ) {
        throw new Error(
            'Certificate image dimensions must be finite and positive',
        );
    }
    const [pageWidth, pageHeight] =
        image.width > image.height
            ? [A4_LONG_SIDE, A4_SHORT_SIDE]
            : [A4_SHORT_SIDE, A4_LONG_SIDE];
    const scale = Math.min(
        (pageWidth - 2 * IMAGE_MARGIN) / image.width,
        (pageHeight - 2 * IMAGE_MARGIN) / image.height,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    document.addPage([pageWidth, pageHeight]).drawImage(image, {
        x: (pageWidth - width) / 2,
        y: (pageHeight - height) / 2,
        width,
        height,
    });
}
