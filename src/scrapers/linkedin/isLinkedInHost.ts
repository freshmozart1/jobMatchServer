export default function isLinkedInHost(hostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();

    return normalizedHostname === "linkedin.com" || normalizedHostname.endsWith(".linkedin.com");
}