export default async function fetchTokens(text, model, tokenServiceUrl = process.env['TOKEN_SERVICE_URL']) {
    if (!tokenServiceUrl)
        throw new Error('Token service URL is not defined in environment variables.');
    return fetch(tokenServiceUrl + '/count', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            text,
            model,
        }),
    });
}
//# sourceMappingURL=fetchTokens.js.map