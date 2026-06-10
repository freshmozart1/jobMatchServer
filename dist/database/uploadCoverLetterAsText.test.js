import { beforeEach, describe, expect, it, jest } from "@jest/globals";
const insertedCoverLetterId = "inserted-cover-letter-id";
const upsertedCoverLetterId = "upserted-cover-letter-id";
const connect = jest.fn();
const insertOne = jest.fn();
const findOneAndReplace = jest.fn();
const segmentCoverLetter = jest.fn();
const createStoredCoverLetterFromTextSegments = jest.fn();
const segments = {
    subject: "Subject: Application",
    salutation: "Dear Hiring Manager,",
    introduction: "I am excited to apply.",
    mainBody: "I build software.",
    conclusion: "I look forward to speaking with you.",
    greetings: "Best regards\nOle",
};
const storedCoverLetter = {
    subject: { text: segments.subject, embedding: [0.1] },
    salutation: { text: segments.salutation, embedding: [0.2] },
    introduction: { text: segments.introduction, embedding: [0.3] },
    mainBody: { text: segments.mainBody, embedding: [0.4] },
    conclusion: { text: segments.conclusion, embedding: [0.5] },
    greetings: { text: segments.greetings, embedding: [0.6] },
};
jest.unstable_mockModule("./database.js", () => ({
    client: { connect },
    coverLettersCollection: { insertOne, findOneAndReplace },
}));
jest.unstable_mockModule("../coverLetters/coverLetterSegmentation.js", () => ({
    segmentCoverLetter,
}));
jest.unstable_mockModule("../coverLetters/coverLetterEmbeddings.js", () => ({
    createStoredCoverLetterFromTextSegments,
}));
const { default: uploadCoverLetterAsText } = await import("./uploadCoverLetterAsText.js");
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
describe("uploadCoverLetterAsText", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        connect.mockResolvedValue();
        insertOne.mockResolvedValue({ insertedId: insertedCoverLetterId });
        findOneAndReplace.mockResolvedValue({ _id: upsertedCoverLetterId });
        segmentCoverLetter.mockResolvedValue({ segments });
        createStoredCoverLetterFromTextSegments.mockResolvedValue(storedCoverLetter);
    });
    it("segments, embeds, stores the cover letter, and responds with the inserted id", async () => {
        const coverLetterText = "Dear Hiring Manager,\n\nI am excited to apply.\n\nBest regards\nOle";
        const request = createRequest({ coverLetterText });
        const { response, status, json } = createResponse();
        await uploadCoverLetterAsText(request, response);
        expect(segmentCoverLetter).toHaveBeenCalledWith(coverLetterText);
        expect(createStoredCoverLetterFromTextSegments).toHaveBeenCalledWith(segments);
        expect(insertOne).toHaveBeenCalledWith(storedCoverLetter);
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Cover letter uploaded", coverLetterId: insertedCoverLetterId });
        expect(connect).toHaveBeenCalledTimes(1);
    });
    it("upserts the cover letter by jobDuplicateKey when provided", async () => {
        const coverLetterText = "Dear Hiring Manager,\n\nI am excited to apply.\n\nBest regards\nOle";
        const jobDuplicateKey = "job-key-1";
        const request = createRequest({ coverLetterText, jobDuplicateKey });
        const { response, status, json } = createResponse();
        await uploadCoverLetterAsText(request, response);
        expect(segmentCoverLetter).toHaveBeenCalledWith(coverLetterText);
        expect(createStoredCoverLetterFromTextSegments).toHaveBeenCalledWith(segments);
        expect(findOneAndReplace).toHaveBeenCalledWith({ jobDuplicateKey }, { ...storedCoverLetter, jobDuplicateKey }, { upsert: true, returnDocument: "after" });
        expect(insertOne).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ message: "Cover letter uploaded", coverLetterId: upsertedCoverLetterId });
        expect(connect).toHaveBeenCalledTimes(1);
    });
    it("returns 400 when jobDuplicateKey is present but empty", async () => {
        const request = createRequest({ coverLetterText: "valid cover letter", jobDuplicateKey: "   " });
        const { response, status, json } = createResponse();
        await uploadCoverLetterAsText(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include a non-empty coverLetterText string and may include a non-empty jobDuplicateKey string" });
        expect(segmentCoverLetter).not.toHaveBeenCalled();
        expect(createStoredCoverLetterFromTextSegments).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
    it("returns 400 when the request body is invalid", async () => {
        const request = createRequest({ coverLetterText: "   " });
        const { response, status, json } = createResponse();
        await uploadCoverLetterAsText(request, response);
        expect(status).toHaveBeenCalledWith(400);
        expect(json).toHaveBeenCalledWith({ message: "Request body must include a non-empty coverLetterText string and may include a non-empty jobDuplicateKey string" });
        expect(segmentCoverLetter).not.toHaveBeenCalled();
        expect(createStoredCoverLetterFromTextSegments).not.toHaveBeenCalled();
        expect(insertOne).not.toHaveBeenCalled();
        expect(findOneAndReplace).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
    });
});
//# sourceMappingURL=uploadCoverLetterAsText.test.js.map