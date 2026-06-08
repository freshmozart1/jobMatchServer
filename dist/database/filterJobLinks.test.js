import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const close = jest.fn();
const toArray = jest.fn();
const find = jest.fn();
jest.unstable_mockModule("./database.js", () => ({
    client: { close },
    jobsCollection: { find },
}));
const { default: filterJobLinks } = await import("./filterJobLinks.js");
function createRequest(body) {
    return { body };
}
function createResponse() {
    const status = jest.fn();
    const json = jest.fn();
    const response = { status, json };
    status.mockReturnValue(response);
    json.mockReturnValue(response);
    return { response, status, json };
}
describe("filterJobLinks", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        close.mockResolvedValue();
        toArray.mockResolvedValue([]);
        find.mockReturnValue({ toArray });
    });
    it("removes stored sourceUrl values and preserves keyword keys", async () => {
        const storedUrl = "https://www.linkedin.com/jobs/view/stored";
        const newUrl = "https://www.linkedin.com/jobs/view/new";
        const anotherStoredUrl = "https://www.linkedin.com/jobs/view/another-stored";
        const request = createRequest({
            react: [storedUrl, newUrl],
            node: [anotherStoredUrl],
        });
        const { response, status, json } = createResponse();
        toArray.mockResolvedValue([{ sourceUrl: storedUrl }, { sourceUrl: anotherStoredUrl }]);
        await filterJobLinks(request, response);
        expect(find).toHaveBeenCalledWith({ sourceUrl: { $in: [storedUrl, newUrl, anotherStoredUrl] } }, { projection: { sourceUrl: 1, _id: 0 } });
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ react: [newUrl], node: [] });
        expect(close).toHaveBeenCalledTimes(1);
    });
    it("returns all links when none of the URLs are already stored", async () => {
        const requestBody = {
            design: ["https://www.linkedin.com/jobs/view/design"],
            frontend: ["https://www.linkedin.com/jobs/view/frontend"],
        };
        const request = createRequest(requestBody);
        const { response, status, json } = createResponse();
        await filterJobLinks(request, response);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(requestBody);
        expect(close).toHaveBeenCalledTimes(1);
    });
    it("deduplicates URLs before querying MongoDB", async () => {
        const duplicateUrl = "https://www.linkedin.com/jobs/view/duplicate";
        const request = createRequest({
            react: [duplicateUrl],
            frontend: [duplicateUrl],
        });
        const { response } = createResponse();
        await filterJobLinks(request, response);
        expect(find).toHaveBeenCalledWith({ sourceUrl: { $in: [duplicateUrl] } }, { projection: { sourceUrl: 1, _id: 0 } });
    });
    it("returns empty shapes without querying MongoDB when no URLs are provided", async () => {
        const requestBody = { react: [], node: [] };
        const request = createRequest(requestBody);
        const { response, status, json } = createResponse();
        await filterJobLinks(request, response);
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith(requestBody);
        expect(find).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
    it("returns 400 for invalid request bodies", async () => {
        const invalidBodies = [null, [], { react: "https://www.linkedin.com/jobs/view/1" }, { react: [1] }];
        for (const invalidBody of invalidBodies) {
            const request = createRequest(invalidBody);
            const { response, status, json } = createResponse();
            await filterJobLinks(request, response);
            expect(status).toHaveBeenCalledWith(400);
            expect(json).toHaveBeenCalledWith({
                message: "Request body must be an object mapping keywords to URL arrays",
            });
        }
        expect(find).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
    });
    it("closes the MongoDB client when the lookup fails", async () => {
        const lookupError = new Error("Lookup failed");
        const request = createRequest({ react: ["https://www.linkedin.com/jobs/view/1"] });
        const { response } = createResponse();
        toArray.mockRejectedValue(lookupError);
        await expect(filterJobLinks(request, response)).rejects.toThrow(lookupError);
        expect(close).toHaveBeenCalledTimes(1);
    });
});
//# sourceMappingURL=filterJobLinks.test.js.map