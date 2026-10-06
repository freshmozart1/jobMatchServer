import { unlink } from 'fs/promises';
import path from 'path';
import {
    type Collection,
    MongoBulkWriteError,
    MongoServerError,
    MongoWriteConcernError,
} from 'mongodb';
import type { StoredCertificate, StoredCv } from '#types';

async function removeUploadFiles(filePaths: string[]): Promise<void> {
    await Promise.all(
        filePaths.map(async (filePath) => {
            try {
                await unlink(filePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error(
                        'Could not remove an unused upload file',
                        error,
                    );
                }
            }
        }),
    );
}

function isDefinitiveWriteRejection(error: unknown): boolean {
    if (error instanceof MongoBulkWriteError) {
        // Ordered writes stop at the first acknowledged write error. Generated
        // insertedIds are not proof of persistence, including on network errors.
        return (
            Array.isArray(error.writeErrors) &&
            error.writeErrors.length > 0 &&
            !error.err &&
            !error.result.getWriteConcernError()
        );
    }
    return (
        error instanceof MongoServerError &&
        !(error instanceof MongoWriteConcernError) &&
        (error.code === 11000 || error.code === 121)
    );
}

const ownershipReadOptions = {
    projection: { filePath: 1 },
    readPreference: 'primary' as const,
    readConcern: { level: 'local' as const },
};

async function rejectedUploadPaths(
    collection: Collection<StoredCv> | Collection<StoredCertificate>,
    filePaths: string[],
    error: unknown,
): Promise<string[]> {
    if (!isDefinitiveWriteRejection(error)) {
        // Even an empty read now cannot rule out a late server-side commit.
        console.error(
            'Upload write outcome is uncertain; retaining uploaded files',
        );
        return [];
    }
    try {
        const records = await collection
            .find({ filePath: { $in: filePaths } }, ownershipReadOptions)
            .toArray();
        const referenced = new Set(records.map((record) => record.filePath));
        return filePaths.filter((filePath) => !referenced.has(filePath));
    } catch (readError) {
        console.error(
            'Upload ownership could not be checked; retaining uploaded files',
            readError,
        );
        return [];
    }
}

// Ownership transfers before invoking the write. A resolved write stays committed
// even if the caller later fails while replying, closing, or removing an old CV.
export class UploadFileOwnership {
    constructor(private uncommittedPaths: string[]) {}

    async persist<Result>(
        collection: Collection<StoredCv> | Collection<StoredCertificate>,
        write: () => Promise<Result>,
    ): Promise<Result> {
        const pendingPaths = this.uncommittedPaths;
        this.uncommittedPaths = [];
        try {
            return await write();
        } catch (error) {
            this.uncommittedPaths = await rejectedUploadPaths(
                collection,
                pendingPaths,
                error,
            );
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        await removeUploadFiles(this.uncommittedPaths);
    }
}

export async function removeSupersededCv(
    collection: Collection<StoredCv>,
    previousPath: string | undefined,
    currentPath: string,
): Promise<void> {
    if (typeof previousPath !== 'string' || !previousPath) return;
    const resolvedPath = path.resolve(previousPath);
    // Multer writes directly into this directory. Do not follow stored paths
    // outside it, including nested directories that might contain symlinks.
    if (
        path.dirname(resolvedPath) !== path.resolve('uploads/cv') ||
        resolvedPath === path.resolve(currentPath)
    )
        return;
    try {
        // Check every CV reference so relative/absolute aliases are equivalent.
        // Normal uploads always receive fresh random filenames, so a concurrent
        // replacement cannot reintroduce this superseded path after the read.
        const records = await collection
            .find({}, ownershipReadOptions)
            .toArray();
        if (
            records.some(
                (record) => path.resolve(record.filePath) === resolvedPath,
            )
        )
            return;
        await removeUploadFiles([resolvedPath]);
    } catch (error) {
        console.error(
            'Previous CV ownership could not be checked; retaining its file',
            error,
        );
    }
}
