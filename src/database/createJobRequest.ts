import type {
    CompanyAddress,
    CreateJobInDatabaseRequestBody,
    ScrapedJob,
} from '#types';

type Validator = (value: unknown) => boolean;
type Shape = Record<string, Validator>;

const isString: Validator = (value) => typeof value === 'string';
const isFiniteNumber: Validator = (value) =>
    typeof value === 'number' && Number.isFinite(value);
const isNonBlankString: Validator = (value) =>
    typeof value === 'string' && value.trim().length > 0;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function optional(validate: Validator): Validator {
    return (value) => value === undefined || validate(value);
}

function arrayOf(validate: Validator): Validator {
    // Array.from also checks sparse entries rather than skipping them.
    return (value) => Array.isArray(value) && Array.from(value).every(validate);
}

function matchesShape(value: unknown, shape: Shape): boolean {
    return (
        isPlainObject(value) &&
        Object.keys(value).every((key) => Object.hasOwn(shape, key)) &&
        Object.entries(shape).every(([key, validate]) => validate(value[key]))
    );
}

const addressShape = {
    streetAddress: isString,
    city: isString,
    postalCode: isString,
    countryCode: isString,
} satisfies Record<keyof CompanyAddress, Validator>;

const isEmbedding: Validator = (value) =>
    Array.isArray(value) && value.length > 0 && arrayOf(isFiniteNumber)(value);

const jobShape = {
    sourceHostname: isString,
    sourceJobId: optional(isString),
    sourceUrl: isString,
    title: isString,
    company: isString,
    location: optional(isString),
    descriptionText: optional(isString),
    postedAt: optional(isString),
    scrapedAt: isString,
    tags: optional(arrayOf(isString)),
    duplicateKey: isNonBlankString,
    companyAddresses: arrayOf((value) => matchesShape(value, addressShape)),
    embedding: isEmbedding,
    match: optional(isFiniteNumber),
} satisfies Record<keyof ScrapedJob, Validator>;

const requestShape = {
    job: (value: unknown) => matchesShape(value, jobShape),
    like: (value: unknown) => typeof value === 'boolean',
} satisfies Record<keyof CreateJobInDatabaseRequestBody, Validator>;

export default function isValidCreateJobRequestBody(
    body: unknown,
): body is CreateJobInDatabaseRequestBody {
    return matchesShape(body, requestShape);
}
