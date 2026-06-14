export const MONGODB_CONNECTION = process.env["MONGODB_CONNECTION_STRING"];
export function getCollection(client, collectionName) {
    return client.db('jobMatch').collection(collectionName);
}
export function connectionStringConfigured(response) {
    if (!MONGODB_CONNECTION) {
        response.status(500).json({ message: "MongoDB connection string is not configured" });
        return false;
    }
    return true;
}
//# sourceMappingURL=constants.js.map