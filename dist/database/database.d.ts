import type { StoredCoverLetter, StoredCv, StoredScrapedJob } from "#types";
import type { Response } from "express";
import type { MongoClient } from "mongodb";
export declare const MONGODB_CONNECTION: string | undefined;
export declare function getCollection<T extends StoredCoverLetter | StoredScrapedJob | StoredCv>(client: MongoClient, collectionName: 'coverLetters' | 'jobs' | 'cv'): import("mongodb").Collection<T>;
export declare function connectionStringConfigured(response: Response): boolean;
//# sourceMappingURL=database.d.ts.map