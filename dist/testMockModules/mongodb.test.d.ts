import { jest } from "@jest/globals";
export declare const connect: import("jest-mock").Mock<() => Promise<void>>;
export declare const close: import("jest-mock").Mock<() => Promise<void>>;
export declare function createToArray<T>(): ReturnType<typeof jest.fn<() => Promise<T[]>>>;
export declare function createFind<T>(): import("jest-mock").Mock<(...args: unknown[]) => {
    toArray: ReturnType<typeof createToArray<T>>;
}>;
export declare function mockMongoDbModule(): import("@jest/environment").Jest;
//# sourceMappingURL=mongodb.test.d.ts.map