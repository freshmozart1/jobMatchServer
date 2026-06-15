import { jest } from "@jest/globals";
export const connect = jest.fn();
export const close = jest.fn();
export function createToArray() {
    return jest.fn();
}
export function createFind() {
    return jest.fn();
}
export function mockMongoDbModule() {
    return jest.unstable_mockModule("mongodb", () => ({
        MongoClient: jest.fn().mockImplementation(() => ({
            connect,
            close
        })),
        ObjectId: jest.fn().mockImplementation((id) => id)
    }));
}
//# sourceMappingURL=mongodb.test.js.map