export default function createRequest({ body, query }) {
    if (body)
        return { body };
    return { query };
}
//# sourceMappingURL=createRequest.test.js.map