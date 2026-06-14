import type { StoredCoverLetter, StoredCv, StoredScrapedJob } from "#types";
import type { Response } from "express";
import type { MongoClient } from "mongodb";

export const MONGODB_CONNECTION = process.env["MONGODB_CONNECTION_STRING"];

export function getCollection<T extends StoredCoverLetter | StoredScrapedJob | StoredCv>(client: MongoClient, collectionName: 'coverLetters' | 'jobs' | 'cv') {
    return client.db('jobMatch').collection<T>(collectionName);
}

export function connectionStringConfigured(response: Response) {
    if (!MONGODB_CONNECTION) {
        response.status(500).json({ message: "MongoDB connection string is not configured" });
        return false;
    }
    return true;
}

