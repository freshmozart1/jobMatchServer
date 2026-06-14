import type { StoredCoverLetter, StoredScrapedJob } from "#types";
import type { Response } from "express";
import type { MongoClient } from "mongodb";
export declare const MONGODB_CONNECTION: string | undefined;
export declare function getCollection<T extends StoredCoverLetter | StoredScrapedJob>(client: MongoClient, collectionName: 'coverLetters' | 'jobs'): import("mongodb").Collection<T>;
export declare function connectionStringConfigured(response: Response): boolean;
//# sourceMappingURL=constants.d.ts.map