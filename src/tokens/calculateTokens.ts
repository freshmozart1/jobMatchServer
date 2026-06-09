import type { Request, Response } from "express";

type CalculateTokensRequestBody = {
    text: string;
    model?: string | undefined;
};

export default async function countTokens(request: Request<object, object, CalculateTokensRequestBody>, response: Response): Promise<void> {
    const tokenServiceUrl = process.env['TOKEN_SERVICE_URL'];
    if (!tokenServiceUrl) {
        response.status(500).json({ error: "Token service URL is not defined in environment variables." });
        return;
    }
    const tokenServiceResponse = await fetch(tokenServiceUrl + "/count", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            text: request.body.text,
            model: request.body.model,
        }),
    });

    if (!tokenServiceResponse.ok) {
        response.status(500).json({ error: "Failed to calculate tokens." });
        return;
    }

    const tokenCount = await tokenServiceResponse.json();
    response.status(200).json({ tokenCount });
}