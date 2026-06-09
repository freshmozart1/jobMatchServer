import fetchTokens from "./fetchTokens.js";
export default async function countTokens(request, response) {
    let tokenServiceResponse;
    try {
        tokenServiceResponse = await fetchTokens(request.body.text, request.body.model);
    }
    catch (error) {
        response.status(500).json({ error: "Error connecting to token service.", details: error instanceof Error ? error.message : String(error) });
        return;
    }
    if (!tokenServiceResponse.ok) {
        response.status(500).json({ error: "Failed to calculate tokens." });
        return;
    }
    const tokenCount = await tokenServiceResponse.json();
    response.status(200).json({ tokenCount });
}
//# sourceMappingURL=calculateTokens.js.map