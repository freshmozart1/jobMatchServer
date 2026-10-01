// fallow-ignore-file security-sink
// Header sink verified 2026-10: reflected origins must match validated exact
// configured/default origins or a valid legacy 192.168.*.*:5173 HTTP origin.
import type { RequestHandler } from 'express';

const DEFAULT_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
];
const LAN_ORIGIN_PATTERN = /^http:\/\/192\.168\.\d+\.\d+:5173$/;

function isSerializedHttpOrigin(value: string): boolean {
    try {
        const url = new URL(value);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            url.origin === value &&
            !url.hostname.includes('*')
        );
    } catch {
        return false;
    }
}

function getAllowedOrigins(configuredOrigins?: string): Set<string> {
    const origins = new Set(DEFAULT_ORIGINS);
    if (!configuredOrigins?.trim()) return origins;

    configuredOrigins.split(',').forEach((entry, index) => {
        const origin = entry.trim();
        if (!isSerializedHttpOrigin(origin)) {
            // Do not repeat an invalid value: it may itself contain credentials.
            throw new Error(
                `Invalid CORS_ALLOWED_ORIGINS entry ${index + 1}: expected an exact HTTP(S) origin without credentials, paths, query, fragments, or wildcards.`,
            );
        }
        origins.add(origin);
    });
    return origins;
}

export default function createCorsMiddleware(
    configuredOrigins?: string,
): RequestHandler {
    const allowedOrigins = getAllowedOrigins(configuredOrigins);

    return (request, response, next): void => {
        const origin = request.get('origin');
        // A cached response for no/disallowed Origin must not mask allowed ones.
        response.vary('Origin');
        if (
            origin &&
            (allowedOrigins.has(origin) ||
                (LAN_ORIGIN_PATTERN.test(origin) &&
                    isSerializedHttpOrigin(origin)))
        ) {
            response.setHeader('Access-Control-Allow-Origin', origin);
        }
        response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (request.method === 'OPTIONS') {
            response.sendStatus(204);
            return;
        }
        next();
    };
}
