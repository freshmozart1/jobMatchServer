import { MongoClient } from "mongodb";
export const mongoDbConnectionString = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000";
export const client = new MongoClient(mongoDbConnectionString);
export const database = client.db('jobMatch');
export const jobsCollection = database.collection('jobs');
export const coverLettersCollection = database.collection('coverLetters');
export const cvCollection = database.collection('cv');
//# sourceMappingURL=database.js.map