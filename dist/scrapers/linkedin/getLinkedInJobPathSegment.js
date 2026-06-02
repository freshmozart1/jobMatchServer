export default function getLinkedInJobPathSegment(url) {
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length < 3 || pathParts[0] !== "jobs" || pathParts[1] !== "view") {
        return null;
    }
    return pathParts[2] || null;
}
//# sourceMappingURL=getLinkedInJobPathSegment.js.map