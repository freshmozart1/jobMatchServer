import { describe, expect, it } from "@jest/globals";
import isLinkedInHost from "./isLinkedInHost.js";
describe("isLinkedInHost", () => {
    it("accepts linkedin.com", () => {
        expect(isLinkedInHost("linkedin.com")).toBe(true);
    });
    it("accepts www.linkedin.com", () => {
        expect(isLinkedInHost("www.linkedin.com")).toBe(true);
    });
    it("accepts arbitrary subdomains", () => {
        expect(isLinkedInHost("sub.linkedin.com")).toBe(true);
    });
    it("is case-insensitive", () => {
        expect(isLinkedInHost("LinkedIn.COM")).toBe(true);
        expect(isLinkedInHost("WWW.LINKEDIN.COM")).toBe(true);
    });
    it("rejects a domain that ends with linkedin.com but is not a subdomain", () => {
        expect(isLinkedInHost("evil-linkedin.com")).toBe(false);
    });
    it("rejects unrelated domains", () => {
        expect(isLinkedInHost("notlinkedin.com")).toBe(false);
        expect(isLinkedInHost("google.com")).toBe(false);
    });
    it("rejects an empty string", () => {
        expect(isLinkedInHost("")).toBe(false);
    });
});
//# sourceMappingURL=isLinkedInHost.test.js.map