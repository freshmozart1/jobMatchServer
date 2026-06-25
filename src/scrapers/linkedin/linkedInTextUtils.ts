export function normalizeText(value: string | null | undefined): string | null {
  const normalizedValue = value?.replace(/\s+/g, ' ').trim() ?? '';
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function normalizeMultilineText(
  value: string | null | undefined,
): string | null {
  const normalizedValue =
    value
      ?.replace(/\r\n?/g, '\n')
      .replace(/[\t ]+\n/g, '\n')
      .replace(/\n[\t ]+/g, '\n')
      .replace(/[\t ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim() ?? '';
  return normalizedValue.length > 0 ? normalizedValue : null;
}

export function normalizeDescription(value: string | null): string | null {
  const normalizedValue = normalizeMultilineText(value);
  if (!normalizedValue || isModalOrLegalText(normalizedValue)) {
    return null;
  }
  return normalizedValue;
}

export function coalesceText(
  ...values: Array<string | null | undefined>
): string {
  for (const value of values) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      return normalizedValue;
    }
  }
  return '';
}

export function stripLinkedInSuffix(
  value: string | null | undefined,
): string | null {
  return normalizeText(value?.replace(/\s*\|\s*LinkedIn$/i, ''));
}

export function extractJobTitle(
  value: string | null | undefined,
): string | null {
  const withoutSuffix = stripLinkedInSuffix(value);
  if (!withoutSuffix) return null;

  const suchtMatch = withoutSuffix.match(
    /^.+?\s+sucht\s+(.+?)(?:\s+in\s+\S.*)?$/i,
  );
  if (suchtMatch) return normalizeText(suchtMatch[1]);

  return withoutSuffix;
}

export function getTitleFromPageTitle(pageTitle: string): string | null {
  const normalizedPageTitle = normalizeText(pageTitle);
  if (!normalizedPageTitle) {
    return null;
  }

  const titleWithoutLinkedIn =
    stripLinkedInSuffix(normalizedPageTitle) ?? normalizedPageTitle;

  const atBeiMatch = titleWithoutLinkedIn.match(/^(.+?)\s+(?:at|bei)\s+.+$/i);
  if (atBeiMatch) return normalizeText(atBeiMatch[1]);

  const suchtMatch = titleWithoutLinkedIn.match(
    /^.+?\s+sucht\s+(.+?)(?:\s+in\s+\S.*)?$/i,
  );
  if (suchtMatch) return normalizeText(suchtMatch[1]);

  return normalizeText(titleWithoutLinkedIn);
}

export function getCompanyFromPageTitle(pageTitle: string): string | null {
  const normalizedPageTitle = normalizeText(pageTitle);
  const companyMatch = normalizedPageTitle?.match(
    /\s+(?:at|bei)\s+(.+?)(?:\s+\|\s+LinkedIn)?$/i,
  );
  return normalizeText(companyMatch?.[1]);
}

export function isModalOrLegalText(value: string): boolean {
  const normalizedValue = value.toLowerCase();
  return (
    (normalizedValue.includes('einloggen') &&
      normalizedValue.includes('linkedin') &&
      normalizedValue.includes('mitglied werden')) ||
    (normalizedValue.includes('sign in') &&
      normalizedValue.includes('linkedin') &&
      normalizedValue.includes('join now'))
  );
}
