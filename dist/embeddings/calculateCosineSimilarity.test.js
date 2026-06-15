import { describe, expect, it } from "@jest/globals";
import calculateCosineSimilarity from "./calculateCosineSimilarity.js";
describe("calculateCosineSimilarity", () => {
    it("returns 1.0 for identical vectors", () => {
        expect(calculateCosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0);
    });
    it("returns 0.0 for orthogonal vectors", () => {
        expect(calculateCosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
    });
    it("returns -1.0 for opposite vectors", () => {
        expect(calculateCosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
    });
    it("computes a known 2D result", () => {
        // [3,4]·[4,3] = 24, |[3,4]|=5, |[4,3]|=5, similarity = 24/25
        expect(calculateCosineSimilarity([3, 4], [4, 3])).toBeCloseTo(24 / 25);
    });
    it("returns 0 when one vector is all zeros", () => {
        expect(calculateCosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
    it("throws when vectors have different lengths", () => {
        expect(() => calculateCosineSimilarity([1, 2], [1, 2, 3])).toThrow();
    });
});
//# sourceMappingURL=calculateCosineSimilarity.test.js.map