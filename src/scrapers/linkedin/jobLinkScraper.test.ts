import { describe, expect, it } from "@jest/globals";
import { getLinkedInJobLinkSearchParamsFromBody } from "./jobLinkScraper.js";

describe("getLinkedInJobLinkSearchParamsFromBody", () => {
    it("parses a valid body with a single keyword", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({
            keywords: "TypeScript",
            location: "Berlin",
            distance: 25,
        })).toEqual({ keywords: ["TypeScript"], location: "Berlin", distance: 25 });
    });

    it("parses a valid body with multiple keywords", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({
            keywords: ["TypeScript", "Node.js"],
            location: "Hamburg",
            distance: 10,
        })).toEqual({ keywords: ["TypeScript", "Node.js"], location: "Hamburg", distance: 10 });
    });

    it("wraps a plain string keyword in an array", () => {
        const result = getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: "Munich", distance: 5 });
        expect(result?.keywords).toEqual(["Go"]);
    });

    it("deduplicates keywords after trimming", () => {
        const result = getLinkedInJobLinkSearchParamsFromBody({
            keywords: ["TypeScript", "  TypeScript  ", "Go"],
            location: "Berlin",
            distance: 25,
        });
        expect(result?.keywords).toEqual(["TypeScript", "Go"]);
    });

    it("trims leading and trailing whitespace from keywords", () => {
        const result = getLinkedInJobLinkSearchParamsFromBody({
            keywords: ["  TypeScript  "],
            location: "Berlin",
            distance: 25,
        });
        expect(result?.keywords).toEqual(["TypeScript"]);
    });

    it("trims the location", () => {
        const result = getLinkedInJobLinkSearchParamsFromBody({
            keywords: "Go",
            location: "  Berlin  ",
            distance: 5,
        });
        expect(result?.location).toBe("Berlin");
    });

    it("returns null when body is null", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody(null)).toBeNull();
    });

    it("returns null when body is not an object", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody("string")).toBeNull();
        expect(getLinkedInJobLinkSearchParamsFromBody(42)).toBeNull();
    });

    it("returns null when keywords is missing", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ location: "Berlin", distance: 25 })).toBeNull();
    });

    it("returns null when location is missing", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", distance: 25 })).toBeNull();
    });

    it("returns null when distance is missing", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: "Berlin" })).toBeNull();
    });

    it("returns null when a keyword is not a string", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({
            keywords: ["TypeScript", 42],
            location: "Berlin",
            distance: 25,
        })).toBeNull();
    });

    it("returns null when a keyword is empty after trimming", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({
            keywords: ["  "],
            location: "Berlin",
            distance: 25,
        })).toBeNull();
    });

    it("returns null when location is not a string", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: 123, distance: 25 })).toBeNull();
    });

    it("returns null when distance is zero", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: "Berlin", distance: 0 })).toBeNull();
    });

    it("returns null when distance is negative", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: "Berlin", distance: -5 })).toBeNull();
    });

    it("returns null when distance is a float", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: "Berlin", distance: 1.5 })).toBeNull();
    });

    it("returns null when distance is not a number", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: "Go", location: "Berlin", distance: "25" })).toBeNull();
    });

    it("returns null when keywords array is empty", () => {
        expect(getLinkedInJobLinkSearchParamsFromBody({ keywords: [], location: "Berlin", distance: 25 })).toBeNull();
    });
});
