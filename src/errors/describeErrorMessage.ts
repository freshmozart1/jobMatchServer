// Reduces a rejection value to a single message string, never the error object
// itself: an Error's own fields are non-enumerable, so stringifying it yields
// `{}` (#124), while spreading it would leak internal state.
//
// Every fallback is load-bearing:
//   - `message || name`: `new Error().message` is `''`, which tells the reader
//     nothing.
//   - the error-like `message`: a `{ message, code }` object or a cross-realm
//     Error fails `instanceof` yet still carries a real message, one `String()`
//     would flatten to "[object Object]". Only `message` is read, so no other
//     field of the rejection can leak, and a throwing getter reads as absent.
//   - the try/catch: `String()` throws on a null-prototype object (or anything
//     else lacking `toString`/`valueOf`), and callers rely on this never
//     throwing.
export function describeErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        return error.message || error.name || fallback;
    }
    const errorLike = errorLikeMessage(error);
    if (errorLike !== undefined) return errorLike;
    try {
        return String(error) || fallback;
    } catch {
        return fallback;
    }
}

function errorLikeMessage(error: unknown): string | undefined {
    try {
        const message = (error as { message?: unknown } | null | undefined)
            ?.message;
        return typeof message === 'string' && message.length > 0
            ? message
            : undefined;
    } catch {
        return undefined;
    }
}
