import { describe, expect, it } from "@jest/globals";
import getLinkedInJobPathSegment from "./getLinkedInJobPathSegment.js";
describe("getLinkedInJobPathSegment", () => {
    it("returns the job id segment from a canonical job URL", () => {
        expect(getLinkedInJobPathSegment(new URL("https://www.linkedin.com/jobs/view/1234567/"))).toBe("1234567");
    });
    it("returns the full path segment including slug", () => {
        expect(getLinkedInJobPathSegment(new URL("https://www.linkedin.com/jobs/view/senior-engineer-at-acme-1234567/"))).toBe("senior-engineer-at-acme-1234567");
    });
    it("returns null when the path has only two parts (missing id)", () => {
        expect(getLinkedInJobPathSegment(new URL("https://www.linkedin.com/jobs/view"))).toBeNull();
    });
    it("returns null when the path does not start with jobs", () => {
        expect(getLinkedInJobPathSegment(new URL("https://www.linkedin.com/company/acme/"))).toBeNull();
    });
    it("returns null for a job search page", () => {
        expect(getLinkedInJobPathSegment(new URL("https://www.linkedin.com/jobs/search"))).toBeNull();
    });
    it("returns null when the second segment is not view", () => {
        expect(getLinkedInJobPathSegment(new URL("https://www.linkedin.com/jobs/collections/1234567/"))).toBeNull();
    });
});
//# sourceMappingURL=getLinkedInJobPathSegment.test.js.map