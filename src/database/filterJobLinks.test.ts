import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Request, Response } from "express";
import type { LinkedInJobLinksByKeyword } from "#types";

type StoredSourceUrl = {
    sourceUrl: string;
};

type FindResultMock = {
    toArray: ReturnType<typeof jest.fn<() => Promise<StoredSourceUrl[]>>>;
};

type JobsCollectionMock = {
    find: ReturnType<typeof jest.fn<(filter: unknown, options: unknown) => FindResultMock>>;
};

const close = jest.fn<() => Promise<void>>();
const toArray = jest.fn<() => Promise<StoredSourceUrl[]>>();
const find = jest.fn<(filter: unknown, options: unknown) => FindResultMock>();

jest.unstable_mockModule("./database.js", () => ({
    client: { close },
    jobsCollection: { find } satisfies JobsCollectionMock,
}));

const { default: filterJobLinks } = await import("./filterJobLinks.js");

function createRequest(body: unknown): Request<object, object, LinkedInJobLinksByKeyword> {
    return { body } as Request<object, object, LinkedInJobLinksByKeyword>;
}

function createResponse(): {
    response: Response;
    status: ReturnType<typeof jest.fn<(statusCode: number) => Response>>;
    json: ReturnType<typeof jest.fn<(body: unknown) => Response>>;
} {
    const status = jest.fn<(statusCode: number) => Response>();
    const json = jest.fn<(body: unknown) => Response>();
    const response = { status, json } as unknown as Response;

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

        expect(find).toHaveBeenCalledWith(
            { sourceUrl: { $in: [storedUrl, newUrl, anotherStoredUrl] } },
            { projection: { sourceUrl: 1, _id: 0 } },
        );
        expect(status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ react: [newUrl], node: [] });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it("returns all links when none of the URLs are already stored", async () => {
        const requestBody = {
            design: ["https://www.linkedin.com/jobs/view/design"],
            frontend: ["https://www.linkedin.com/jobs/view/frontend"],
        } satisfies LinkedInJobLinksByKeyword;
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

        expect(find).toHaveBeenCalledWith(
            { sourceUrl: { $in: [duplicateUrl] } },
            { projection: { sourceUrl: 1, _id: 0 } },
        );
    });

    it("returns empty shapes without querying MongoDB when no URLs are provided", async () => {
        const requestBody = { react: [], node: [] } satisfies LinkedInJobLinksByKeyword;
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