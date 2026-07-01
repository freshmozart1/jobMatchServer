export function getTrimmedUniqueKeywords(keywords: unknown): string[] | null {
  const keywordValues = typeof keywords === 'string' ? [keywords] : keywords;

  if (!Array.isArray(keywordValues) || keywordValues.length === 0) {
    return null;
  }

  const trimmedKeywords: string[] = [];

  for (const keywordValue of keywordValues) {
    if (typeof keywordValue !== 'string') {
      return null;
    }

    const trimmedKeyword = keywordValue.trim();

    if (trimmedKeyword.length === 0) {
      return null;
    }

    if (!trimmedKeywords.includes(trimmedKeyword)) {
      trimmedKeywords.push(trimmedKeyword);
    }
  }

  return trimmedKeywords;
}
