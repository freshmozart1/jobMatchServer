import type { StoredScrapedJob, StoredCoverLetter } from "#types";
import { MongoClient } from "mongodb";
export declare const client: MongoClient;
export declare const database: import("mongodb").Db;
export declare const jobsCollection: import("mongodb").Collection<StoredScrapedJob>;
export declare const coverLettersCollection: import("mongodb").Collection<StoredCoverLetter>;
//# sourceMappingURL=database.d.ts.map