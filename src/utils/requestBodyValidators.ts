export function hasStringProp(obj: object, key: string): boolean {
    return (
        key in obj && typeof (obj as Record<string, unknown>)[key] === 'string'
    );
}

export function hasOptionalStringProp(obj: object, key: string): boolean {
    if (!(key in obj)) return false;
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === 'string' || value === undefined;
}

export function hasOptionalStringArrayProp(obj: object, key: string): boolean {
    if (!(key in obj)) return false;
    const value = (obj as Record<string, unknown>)[key];
    return (
        value === undefined ||
        (Array.isArray(value) &&
            value.every((item) => typeof item === 'string'))
    );
}

export function hasOptionalPositiveIntegerProp(
    obj: object,
    key: string,
): boolean {
    if (!(key in obj)) return true;
    const value = (obj as Record<string, unknown>)[key];
    return (
        value === undefined ||
        (typeof value === 'number' && Number.isInteger(value) && value > 0)
    );
}

export function hasBooleanProp(obj: object, key: string): boolean {
    return (
        key in obj && typeof (obj as Record<string, unknown>)[key] === 'boolean'
    );
}

export function hasObjectProp(obj: object, key: string): boolean {
    if (!(key in obj)) return false;
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === 'object' && value !== null;
}
