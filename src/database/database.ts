import type { StoredScrapedJob, StoredCoverLetter } from "#types";
import { MongoClient } from "mongodb";

export const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
export const client = new MongoClient(mongoDbConnectionString);
export const database = client.db('jobMatch');
export const jobsCollection = database.collection<StoredScrapedJob>('jobs');
export const coverLettersCollection = database.collection<StoredCoverLetter>('coverLetters');
export const cvCollection = database.collection('cv');