import type { StoredScrapedJob } from "#types";
import { MongoClient } from "mongodb";

const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
export const client = new MongoClient(mongoDbConnectionString);
export const database = client.db('jobMatch');
export const jobsCollection = database.collection<StoredScrapedJob>('jobs');