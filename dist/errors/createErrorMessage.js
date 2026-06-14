export function createErrorMessage(response, error, customMessage, status = 500) {
    console.error(customMessage, error);
    response.status(status).json({ message: customMessage, error: error instanceof Error ? error.message : String(error) });
}
//# sourceMappingURL=createErrorMessage.js.map