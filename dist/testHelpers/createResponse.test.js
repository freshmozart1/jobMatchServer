import { jest } from "@jest/globals";
export default function createResponse() {
    const status = jest.fn();
    const json = jest.fn();
    const response = { status, json };
    status.mockReturnValue(response);
    json.mockReturnValue(response);
    return { response, status, json };
}
//# sourceMappingURL=createResponse.test.js.map