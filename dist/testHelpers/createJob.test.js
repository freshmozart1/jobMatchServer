export const duplicateKey = "linkedin:123456789";
export const embedding = [0.1, 0.2, 0.3];
export function createJob(like) {
    return {
        sourceHostname: "www.linkedin.com",
        sourceJobId: "123456789",
        sourceUrl: "https://www.linkedin.com/jobs/view/123456789",
        title: "Software Engineer",
        company: "Example Company",
        location: "Remote",
        descriptionText: "Build and maintain TypeScript services.",
        postedAt: "2026-06-01",
        scrapedAt: "2026-06-02T00:00:00.000Z",
        tags: ["typescript", "node"],
        duplicateKey,
        embedding,
        ...(like !== undefined ? { like } : {})
    };
}
//# sourceMappingURL=createJob.test.js.map