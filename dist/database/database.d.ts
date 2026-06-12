import type { StoredScrapedJob, StoredCoverLetter } from "#types";
import { MongoClient } from "mongodb";
export declare const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
export declare const client: MongoClient;
export declare const database: import("mongodb").Db;
export declare const jobsCollection: import("mongodb").Collection<StoredScrapedJob>;
export declare const coverLettersCollection: import("mongodb").Collection<StoredCoverLetter>;
export declare const cvCollection: import("mongodb").Collection<import("bson").Document>;
//# sourceMappingURL=database.d.ts.map