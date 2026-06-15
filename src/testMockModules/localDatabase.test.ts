import { jest } from "@jest/globals";

export const getCollection = jest.fn();
export const connectionStringConfigured = jest.fn().mockReturnValue(true);

export function mockLocalDatabaseModule() {
    return jest.unstable_mockModule("#database/database.js", () => ({
        MONGODB_CONNECTION: "mongodb://test-connection-string",
        getCollection,
        connectionStringConfigured,
    }));
}
