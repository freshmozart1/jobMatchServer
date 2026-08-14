import { jest } from '@jest/globals';
import { close, connect } from './mongodb.test.js';

export const getCollection = jest.fn();
export const connectionStringConfigured = jest.fn().mockReturnValue(true);

export const jobNotFoundError = new Error('Job not found');
export const cvNotFoundError = new Error('CV not found');

// Mirrors the real database.ts USER_ID, run through the mocked ObjectId
// constructor in mongodb.test.ts (which is an identity function), so it's
// the same value handlers see whether or not that module is also mocked.
export const USER_ID = '6a3d03b1dba1b11cee01161c';

type MockJob = { _id: { toHexString: () => string } };
type MockCollection = {
    findOne: (...args: unknown[]) => Promise<unknown>;
};

// Re-implemented (not spread from the real module) so these delegate to the
// `getCollection` mock above — the boundary tests already configure via
// `getCollection.mockImplementation(...)` — instead of the real module's own
// getCollection closure, which a spread would silently bypass.
async function findJobByDuplicateKey(client: unknown, duplicateKey: string) {
    const jobs = getCollection(client, 'jobs') as MockCollection;
    const job = (await jobs.findOne({ duplicateKey })) as MockJob | null;
    if (!job) throw jobNotFoundError;
    return job;
}

async function findJobAndCvByDuplicateKey(
    client: unknown,
    duplicateKey: string,
) {
    const job = await findJobByDuplicateKey(client, duplicateKey);
    const cvs = getCollection(client, 'cv') as MockCollection;
    const cv = await cvs.findOne({ jobId: job._id.toHexString() });
    if (!cv) throw cvNotFoundError;
    return { job, cv };
}

async function findJobIdByDuplicateKey(client: unknown, duplicateKey: string) {
    const jobs = getCollection(client, 'jobs') as MockCollection;
    const job = (await jobs.findOne(
        { duplicateKey },
        { projection: { _id: 1 } },
    )) as MockJob | null;
    if (!job) throw jobNotFoundError;
    return job;
}

// Mirrors the real database.ts createDatabaseClient(): gated by the
// connectionStringConfigured mock above, and returns an object exposing the
// same connect/close mocks from mongodb.test.ts so handler-level
// `await client.connect()` / `await client.close()` calls and test
// assertions on those mocks keep working unchanged.
function createDatabaseClient(response: unknown) {
    if (!connectionStringConfigured(response)) return undefined;
    return { connect, close };
}

export function mockLocalDatabaseModule() {
    return jest.unstable_mockModule('#database/database.js', () => ({
        MONGODB_CONNECTION: 'mongodb://test-connection-string',
        getCollection,
        connectionStringConfigured,
        createDatabaseClient,
        jobNotFoundError,
        cvNotFoundError,
        USER_ID,
        findJobByDuplicateKey,
        findJobAndCvByDuplicateKey,
        findJobIdByDuplicateKey,
    }));
}
