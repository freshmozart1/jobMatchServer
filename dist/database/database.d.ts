import type { StoredScrapedJob } from "#types";
import { MongoClient } from "mongodb";
export declare const client: MongoClient;
export declare const database: import("mongodb").Db;
export declare const jobsCollection: import("mongodb").Collection<StoredScrapedJob>;
//# sourceMappingURL=database.d.ts.map