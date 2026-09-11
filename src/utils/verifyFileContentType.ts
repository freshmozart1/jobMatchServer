import { open } from 'fs/promises';

const FILE_SIGNATURES: Record<string, Buffer> = {
    'application/pdf': Buffer.from('%PDF-', 'ascii'),
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
    'image/jpg': Buffer.from([0xff, 0xd8, 0xff]),
    'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

const MAX_SIGNATURE_LENGTH = Math.max(
    ...Object.values(FILE_SIGNATURES).map((signature) => signature.length),
);

export function matchesFileSignature(
    header: Buffer,
    mimetype: string,
): boolean {
    const signature = FILE_SIGNATURES[mimetype];
    if (!signature) return false;
    if (header.length < signature.length) return false;
    return header.subarray(0, signature.length).equals(signature);
}

export async function fileContentMatchesMimetype(
    filePath: string,
    mimetype: string,
): Promise<boolean> {
    if (!(mimetype in FILE_SIGNATURES)) return false;

    const handle = await open(filePath, 'r');
    try {
        const header = Buffer.alloc(MAX_SIGNATURE_LENGTH);
        const { bytesRead } = await handle.read(
            header,
            0,
            MAX_SIGNATURE_LENGTH,
            0,
        );
        return matchesFileSignature(header.subarray(0, bytesRead), mimetype);
    } finally {
        await handle.close();
    }
}
