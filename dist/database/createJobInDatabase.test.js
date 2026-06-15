import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { mockLocalDatabaseModule, getCollection } from "../testMockModules/localDatabase.test.js";
import { mockMongoDbModule, connect } from "../testMockModules/mongodb.test.js";
import createResponse from "../testHelpers/createResponse.test.js";
import createRequest from "../testHelpers/createRequest.test.js";
import { createJob } from "../testHelpers/createJob.test.js";
const insertedJobId = "inserted-job-id";
const insertOne = jest.fn();
const invalidRequestBodyError = { error: "Request body must include job and boolean like fields", message: "Request body must include job and boolean like fields" };
mockMongoDbModule();
mockLocalDatabaseModule();
const { default: createJobInDatabase } = await import("./createJobInDatabase.js");
describe("createJobInDatabase", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        insertOne.mockResolvedValue({ insertedId: insertedJobId });
        connect.mockResolvedValue();
        getCollection.mockReturnValue({ insertOne });
    });
    it("stores the flattened job and responds with the new job id", async () => {
        const job = createJob();
        const like = true;
        const request = createRequest({ body: { job, like } });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(insertOne).toHaveBeenCalledWith({ ...job, like });
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Job created", jobId: insertedJobId });
        expect(connect).toHaveBeenCalledTimes(1);
    });
    it("returns 400 when the request body does not include a job object", async () => {
        const request = createRequest({ body: { like: true } });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
    it("returns 400 when like is not a boolean", async () => {
        const request = createRequest({ body: { job: createJob(), like: "true" } });
        const { response, status, json } = createResponse();
        await createJobInDatabase(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith(invalidRequestBodyError);
        expect(insertOne).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=createJobInDatabase.test.js.map