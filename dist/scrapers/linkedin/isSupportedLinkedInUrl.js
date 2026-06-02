import getLinkedInJobPathSegment from "./getLinkedInJobPathSegment.js";
import isLinkedInHost from "./isLinkedInHost.js";
export default function isSupportedLinkedInUrl(url, variant) {
    try {
        const parsedUrl = new URL(url);
        return (isLinkedInHost(parsedUrl.hostname) && parsedUrl.protocol === "https:") && ((variant === "jobPage" && getLinkedInJobPathSegment(parsedUrl) !== null) ||
            (variant === "jobSearchPage" && (parsedUrl.pathname === "/jobs/search" || parsedUrl.pathname === "/jobs/search/")));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=isSupportedLinkedInUrl.js.map