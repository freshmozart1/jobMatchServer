import { jest } from "@jest/globals";

export const connect = jest.fn<() => Promise<void>>();
export const close = jest.fn<() => Promise<void>>();

export function createToArray<T>(): ReturnType<typeof jest.fn<() => Promise<T[]>>> {
    return jest.fn<() => Promise<T[]>>();
}

export function createFind<T>() {
    return jest.fn<(...args: unknown[]) => { toArray: ReturnType<typeof createToArray<T>> }>();
}

export function mockMongoDbModule() {
    return jest.unstable_mockModule(
        "mongodb",
        () => (
            {
                MongoClient: jest.fn().mockImplementation(() => (
                    {
                        connect,
                        close
                    }
                )),
                ObjectId: jest.fn().mockImplementation((id: unknown) => id)
            }
        )
    );
}