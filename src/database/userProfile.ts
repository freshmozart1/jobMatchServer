import type { CompanyAddress, StoredUser } from '#types';
import type { MongoClient } from 'mongodb';
import { getCollection, USER_ID } from './database.js';

type Validator = (value: unknown) => boolean;

const isNonBlankString: Validator = (value) =>
    typeof value === 'string' && value.trim().length > 0;

function matchesShape(
    value: unknown,
    shape: Record<string, Validator>,
): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const record = value as Record<string, unknown>;
    return (
        Object.keys(record).every((key) => Object.hasOwn(shape, key)) &&
        Object.entries(shape).every(
            ([key, validate]) =>
                Object.hasOwn(record, key) && validate(record[key]),
        )
    );
}

const addressShape = {
    streetAddress: isNonBlankString,
    city: isNonBlankString,
    postalCode: isNonBlankString,
    countryCode: isNonBlankString,
} satisfies Record<keyof CompanyAddress, Validator>;

const profileShape = {
    name: isNonBlankString,
    email: isNonBlankString,
    tel: isNonBlankString,
    address: (value: unknown) => matchesShape(value, addressShape),
} satisfies Record<keyof StoredUser, Validator>;

export function isValidUserProfile(value: unknown): value is StoredUser {
    return matchesShape(value, profileShape);
}

export class UserProfileMissingError extends Error {
    constructor() {
        super(
            'User profile is not configured. Create it with POST /users/profile before downloading PDFs.',
        );
        this.name = 'UserProfileMissingError';
    }
}

export async function findUserProfile(
    client: MongoClient,
): Promise<StoredUser> {
    const user = await getCollection<StoredUser>(client, 'users').findOne({
        _id: USER_ID,
    });
    if (!user) throw new UserProfileMissingError();
    return user;
}
