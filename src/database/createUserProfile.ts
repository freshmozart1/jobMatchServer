import type { Request, Response } from 'express';
import type { StoredUser } from '#types';
import { MongoServerError } from 'mongodb';
import { createErrorMessage } from '../errors/createErrorMessage.js';
import { createDatabaseClient, getCollection, USER_ID } from './database.js';
import { isValidUserProfile } from './userProfile.js';

export default async function createUserProfile(
    request: Request<object, object, unknown>,
    response: Response,
): Promise<void> {
    if (!isValidUserProfile(request.body)) {
        const message =
            'Provide only name, email, tel and address (streetAddress, city, postalCode, countryCode), all as nonblank strings.';
        response.status(400).json({ message, error: message });
        return;
    }

    try {
        const client = createDatabaseClient(response);
        if (!client) return;
        try {
            await client.connect();
            // The fixed _id is unique: concurrent setup attempts cannot replace
            // an existing profile or create a second single-user identity.
            await getCollection<StoredUser>(client, 'users').insertOne({
                ...request.body,
                _id: USER_ID,
            });
        } finally {
            await client.close();
        }

        response.status(201).json({
            message: 'User profile created',
            userId: USER_ID.toString(),
        });
    } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
            const message = 'User profile already exists and was not changed';
            response.status(409).json({ message, error: message });
            return;
        }
        createErrorMessage(
            response,
            error,
            'Error creating user profile',
            500,
            'Profile setup failed',
        );
    }
}
