import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { StoredUser } from '#types';
import { MongoServerError } from 'mongodb';
import {
    connectionStringConfigured,
    getCollection,
    mockLocalDatabaseModule,
    USER_ID,
} from '../testMockModules/localDatabase.test.js';
import {
    close,
    connect,
    mockMongoDbModule,
} from '../testMockModules/mongodb.test.js';
import createRequest from '../testHelpers/createRequest.test.js';
import createResponse from '../testHelpers/createResponse.test.js';

const profile: StoredUser = {
    name: 'Synthetic Applicant',
    email: 'applicant@example.invalid',
    tel: '+49 30 000000',
    address: {
        streetAddress: 'Example Street 1',
        city: 'Berlin',
        postalCode: '10115',
        countryCode: 'DE',
    },
};
type Document = StoredUser & { _id: unknown };
const records = new Map<string, Document>();
const insertOne = jest.fn<(document: Document) => Promise<unknown>>();
const findOne =
    jest.fn<(filter: { _id: unknown }) => Promise<Document | null>>();

mockMongoDbModule();
mockLocalDatabaseModule();
const { default: createUserProfile } = await import('./createUserProfile.js');
const { findUserProfile } = await import('./userProfile.js');

async function setup(body: unknown) {
    const result = createResponse();
    await createUserProfile(createRequest<unknown>({ body }), result.response);
    return result;
}

describe('single-user profile setup', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        records.clear();
        connectionStringConfigured.mockReturnValue(true);
        connect.mockResolvedValue();
        close.mockResolvedValue();
        getCollection.mockReturnValue({ insertOne, findOne });
        insertOne.mockImplementation(async (document) => {
            const key = String(document._id);
            if (records.has(key)) {
                throw new MongoServerError({
                    code: 11000,
                    message: 'Duplicate synthetic profile',
                });
            }
            records.set(key, structuredClone(document));
            return { acknowledged: true, insertedId: document._id };
        });
        findOne.mockImplementation(
            async ({ _id }) => records.get(String(_id)) ?? null,
        );
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('creates the fresh profile at the identity used by both PDF downloads', async () => {
        const { status, json } = await setup(
            JSON.parse(JSON.stringify(profile)),
        );
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({
            message: 'User profile created',
            userId: USER_ID,
        });
        expect(insertOne).toHaveBeenCalledWith({ ...profile, _id: USER_ID });
        const client = {
            connect,
            close,
        } as unknown as import('mongodb').MongoClient;
        expect(await findUserProfile(client)).toEqual({
            ...profile,
            _id: USER_ID,
        });
        expect(findOne).toHaveBeenCalledWith({ _id: USER_ID });
        expect(connect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('preserves an existing profile when setup is retried with different facts', async () => {
        await setup(profile);
        const { status, json } = await setup({
            ...profile,
            name: 'Different Applicant',
        });
        expect(status).toHaveBeenCalledWith(409);
        expect(json).toHaveBeenCalledWith({
            message: 'User profile already exists and was not changed',
            error: 'User profile already exists and was not changed',
        });
        expect(records.size).toBe(1);
        expect(records.get(USER_ID)).toEqual({ ...profile, _id: USER_ID });
        expect(close).toHaveBeenCalledTimes(2);
    });

    it('allows exactly one concurrent setup attempt to create the profile', async () => {
        const results = await Promise.all([
            setup(profile),
            setup({ ...profile, name: 'Other Applicant' }),
        ]);
        expect(
            results.map(({ status }) => status.mock.calls[0]?.[0]).sort(),
        ).toEqual([201, 409]);
        expect(records.size).toBe(1);
        expect(records.get(USER_ID)?.name).toBe(profile.name);
        expect(close).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['null', null],
        ['array', []],
        ['empty body', {}],
        ['storage-owned id', { ...profile, _id: 'other-id' }],
        ['unknown field', { ...profile, other: 'value' }],
        ['operator field', { ...profile, $set: { name: 'Other' } }],
        ['class instance', Object.assign(new (class {})(), profile)],
        ['missing name', { ...profile, name: undefined }],
        ['blank name', { ...profile, name: ' \n\t' }],
        ['operator name', { ...profile, name: { $ne: null } }],
        ['blank email', { ...profile, email: '' }],
        ['numeric phone', { ...profile, tel: 123 }],
        ['array address', { ...profile, address: [] }],
        ['null address', { ...profile, address: null }],
        [
            'missing address field',
            { ...profile, address: { ...profile.address, city: undefined } },
        ],
        [
            'blank postal code',
            { ...profile, address: { ...profile.address, postalCode: ' ' } },
        ],
        [
            'numeric country',
            { ...profile, address: { ...profile.address, countryCode: 1 } },
        ],
        [
            'unknown address field',
            { ...profile, address: { ...profile.address, _id: 'other' } },
        ],
    ])(
        'rejects %s before database configuration or access',
        async (_label, body) => {
            const { status, json } = await setup(body);
            expect(status).toHaveBeenCalledWith(400);
            expect(json).toHaveBeenCalledWith({
                message: expect.stringContaining('nonblank strings'),
                error: expect.stringContaining('nonblank strings'),
            });
            expect(connectionStringConfigured).not.toHaveBeenCalled();
            expect(getCollection).not.toHaveBeenCalled();
            expect(connect).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
            expect(records.size).toBe(0);
        },
    );

    it('skips database access when configuration is missing', async () => {
        connectionStringConfigured.mockReturnValue(false);
        await setup(profile);
        expect(connectionStringConfigured).toHaveBeenCalledTimes(1);
        expect(connect).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });

    it.each(['connect', 'insert', 'close'])(
        'sanitizes %s failures and closes the client',
        async (operation) => {
            const error = new Error(
                'Synthetic driver error containing private details',
            );
            if (operation === 'connect') connect.mockRejectedValueOnce(error);
            if (operation === 'insert') insertOne.mockRejectedValueOnce(error);
            if (operation === 'close') close.mockRejectedValueOnce(error);
            const { status, json } = await setup(profile);
            expect(status).toHaveBeenCalledWith(500);
            expect(status).not.toHaveBeenCalledWith(201);
            expect(json).toHaveBeenCalledWith({
                message: 'Error creating user profile',
                error: 'Profile setup failed',
            });
            expect(close).toHaveBeenCalledTimes(1);
            expect(console.error).toHaveBeenCalledWith(
                'Error creating user profile',
                error,
            );
        },
    );
});
