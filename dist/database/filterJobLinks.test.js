import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import createResponse from "../testHelpers/createResponse.test.js";
import { mockMongoDbModule, connect, close, createToArray, createFind } from "../testMockModules/mongodb.test.js";
import { mockLocalDatabaseModule, getCollection } from "../testMockModules/localDatabase.test.js";
import createRequest from "../testHelpers/createRequest.test.js";
mockMongoDbModule();
mockLocalDatabaseModule();
const toArray = createToArray();
const find = createFind();
const { default: filterJobLinks } = await import("./filterJobLinks.js");
describe("filterJobLinks", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        connect.mockResolvedValue();
        close.mockResolvedValue();
        getCollection.mockReturnValue({ find });
        toArray.mockResolvedValue([]);
        find.mockReturnValue({ toArray });
    });
    it("removes stored sourceUrl values and preserves keyword keys", async () => {
        const storedUrl = "https://www.linkedin.com/jobs/view/stored";
        const newUrl = "https://www.linkedin.com/jobs/view/new";
        const anotherStoredUrl = "https://www.linkedin.com/jobs/view/another-stored";
        const request = createRequest({ body: {
                react: [storedUrl, newUrl],
                node: [anotherStoredUrl],
            } });
        const { response, status, json } = createResponse();
        toArray.mockResolvedValue([{ sourceUrl: storedUrl }, { sourceUrl: anotherStoredUrl }]);
        await filterJobLinks(request, response);
        expect(find).toHaveBeenCalledWith({ sourceUrl: { $in: [storedUrl, newUrl, anotherStoredUrl] } }, { projection: { sourceUrl: 1, _id: 0 } });
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ react: [newUrl], node: [] });
        expect(connect).toHaveBeenCalledTimes(1);
    });
    it("returns all links when none of the URLs are already stored", async () => {
        const requestBody = {
            design: ["https://www.linkedin.com/jobs/view/design"],
            frontend: ["https://www.linkedin.com/jobs/view/frontend"],
        };
        const request = createRequest({ body: requestBody });
        const { response, status, json } = createResponse();
        await filterJobLinks(request, response);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(requestBody);
        expect(connect).toHaveBeenCalledTimes(1);
    });
    it("deduplicates URLs before querying MongoDB", async () => {
        const duplicateUrl = "https://www.linkedin.com/jobs/view/duplicate";
        const request = createRequest({
            body: {
                react: [duplicateUrl],
                frontend: [duplicateUrl],
            }
        });
        const { response } = createResponse();
        await filterJobLinks(request, response);
        expect(find).toHaveBeenCalledWith({ sourceUrl: { $in: [duplicateUrl] } }, { projection: { sourceUrl: 1, _id: 0 } });
    });
    it("returns empty shapes without querying MongoDB when no URLs are provided", async () => {
        const requestBody = { react: [], node: [] };
        const request = createRequest({ body: requestBody });
        const { response, status, json } = createResponse();
        await filterJobLinks(request, response);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(requestBody);
        expect(find).not.toHaveBeenCalled();
        expect(connect).toHaveBeenCalled();
    });
    it("returns 400 for invalid request bodies", async () => {
        const invalidBodies = [null, [], { react: "https://www.linkedin.com/jobs/view/1" }, { react: [1] }];
        for (const invalidBody of invalidBodies) {
            const request = createRequest({ body: invalidBody });
            const { response, status, json } = createResponse();
            await filterJobLinks(request, response);
            expect(status).toHaveBeenCalledWith(400);
            expect(json).toHaveBeenCalledWith({
                error: "Request body must be an object mapping keywords to URL arrays",
                message: "Request body must be an object mapping keywords to URL arrays",
            });
        }
        expect(find).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=filterJobLinks.test.js.map