import type { CompanyAddress } from '#types';

function stripGermanStateNameFromPostalCode(postalCode: string): string {
  const stateNames = [
    'Baden-Württemberg',
    'Bayern',
    'Berlin',
    'Brandenburg',
    'Bremen',
    'Hamburg',
    'Hessen',
    'Mecklenburg-Vorpommern',
    'Niedersachsen',
    'Nordrhein-Westfalen',
    'Rheinland-Pfalz',
    'Saarland',
    'Sachsen',
    'Sachsen-Anhalt',
    'Schleswig-Holstein',
    'Thüringen',
  ];
  //Remove state name from beginning of postal code if present
  for (const stateName of stateNames) {
    if (postalCode.startsWith(stateName)) {
      return postalCode.slice(stateName.length).trim();
    }
  }
  return postalCode;
}

const LABEL_PARAGRAPH_PATTERN = /primär/i;

export function parseCompanyAddress(
  paragraphs: string[],
): CompanyAddress | null {
  for (let i = 0; i < paragraphs.length; i++) {
    const cityPostalCountry = paragraphs[i];
    if (!cityPostalCountry) continue;

    const firstComma = cityPostalCountry.indexOf(',');
    const lastComma = cityPostalCountry.lastIndexOf(',');
    if (firstComma === -1 || firstComma === lastComma) continue;

    const city = cityPostalCountry.slice(0, firstComma).trim();
    const postalCode = stripGermanStateNameFromPostalCode(
      cityPostalCountry.slice(firstComma + 1, lastComma).trim(),
    );
    const countryCode = cityPostalCountry.slice(lastComma + 1).trim();
    if (!city || !postalCode || !countryCode) continue;

    // Search backward from the city line for the nearest non-label street address
    for (let j = i - 1; j >= 0; j--) {
      const streetAddress = paragraphs[j];
      if (!streetAddress || LABEL_PARAGRAPH_PATTERN.test(streetAddress))
        continue;
      return { streetAddress, city, postalCode, countryCode };
    }
  }
  return null;
}
