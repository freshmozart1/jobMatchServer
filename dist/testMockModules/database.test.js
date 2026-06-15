import { jest } from "@jest/globals";
export function mockDatabase(getCollectionReturnValueMock) {
    return jest.unstable_mockModule("../database/database.js", () => ({
        MONGODB_CONNECTION: "mongodb://test-connection-string",
        getCollection: jest.fn().mockReturnValue(getCollectionReturnValueMock),
        connectionStringConfigured: jest.fn().mockReturnValue(true)
    }));
}
//# sourceMappingURL=database.test.js.map