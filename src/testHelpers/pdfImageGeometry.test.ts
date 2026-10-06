import {
    PDFArray,
    PDFDict,
    PDFName,
    PDFNumber,
    PDFRawStream,
    decodePDFRawStream,
    type PDFPage,
} from 'pdf-lib';

type Matrix = [number, number, number, number, number, number];
function multiply(left: Matrix, right: Matrix): Matrix {
    const [a, b, c, d, e, f] = left;
    const [g, h, i, j, k, l] = right;
    return [
        a * g + c * h,
        b * g + d * h,
        a * i + c * j,
        b * i + d * j,
        a * k + c * l + e,
        b * k + d * l + f,
    ];
}

function rawStream(value: unknown): PDFRawStream {
    if (!(value instanceof PDFRawStream))
        throw new Error('Expected a saved PDF stream');
    return value;
}

// Inspect the saved PDF's image XObject and concatenated content matrices,
// independently of the production placement calculation and drawImage mocks.
export function getPdfImageGeometry(page: PDFPage) {
    const contents = page.node.Contents();
    if (!contents) throw new Error('Image page has no content');
    const streams =
        contents instanceof PDFArray
            ? contents
                  .asArray()
                  .map((ref) => rawStream(page.doc.context.lookup(ref)))
            : [rawStream(contents)];
    const operators = streams
        .map((stream) =>
            Buffer.from(decodePDFRawStream(stream).decode()).toString('ascii'),
        )
        .join('\n');
    const transforms = [
        ...operators.matchAll(
            /^([-+\d.eE]+) ([-+\d.eE]+) ([-+\d.eE]+) ([-+\d.eE]+) ([-+\d.eE]+) ([-+\d.eE]+) cm$/gm,
        ),
    ];
    let matrix: Matrix = [1, 0, 0, 1, 0, 0];
    for (const match of transforms)
        matrix = multiply(matrix, match.slice(1).map(Number) as Matrix);
    const objects = page.node
        .Resources()
        ?.lookup(PDFName.of('XObject'), PDFDict);
    const image = objects
        ?.entries()
        .map(([, ref]) => rawStream(page.doc.context.lookup(ref)))
        .find(
            (stream) =>
                stream.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
        );
    if (!image || !operators.includes(' Do'))
        throw new Error('Image page has no drawn image');
    return {
        pageWidth: page.getWidth(),
        pageHeight: page.getHeight(),
        imageWidth: image.dict
            .lookup(PDFName.of('Width'), PDFNumber)
            .asNumber(),
        imageHeight: image.dict
            .lookup(PDFName.of('Height'), PDFNumber)
            .asNumber(),
        x: matrix[4],
        y: matrix[5],
        width: Math.hypot(matrix[0], matrix[1]),
        height: Math.hypot(matrix[2], matrix[3]),
        matrix,
    };
}
