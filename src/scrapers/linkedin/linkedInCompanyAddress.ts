import type { CompanyAddress } from '#types';
import type { Page } from 'puppeteer';
import { LINKEDIN_USER_AGENT } from './waitForLinkedInPage.js';

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

export function parseCompanyAddress(
  paragraphs: string[],
): CompanyAddress | null {
  const [p1, p2] = paragraphs;
  if (!p1 || !p2) return null;

  const streetAddress = p1;
  const firstComma = p2.indexOf(',');
  const lastComma = p2.lastIndexOf(',');
  if (firstComma === -1 || firstComma === lastComma) return null;

  const city = p2.slice(0, firstComma).trim();
  const postalCode = stripGermanStateNameFromPostalCode(
    p2.slice(firstComma + 1, lastComma).trim(),
  );
  const countryCode = p2.slice(lastComma + 1).trim();
  if (!city || !postalCode || !countryCode) return null;

  return { streetAddress, city, postalCode, countryCode };
}

export async function extractCompanyAddress(
  page: Page,
  companyPageUrl: string,
): Promise<CompanyAddress> {
  const companyPage = await page.browser().newPage();
  try {
    await companyPage.setUserAgent({
      userAgent: LINKEDIN_USER_AGENT,
      platform: 'macOS',
    });
    const cleanUrl = new URL(companyPageUrl);
    cleanUrl.search = '';
    await companyPage.goto(cleanUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await companyPage.waitForSelector('#address-0', { timeout: 15_000 });
    const paragraphs = await companyPage.evaluate(() => {
      const addressDiv = document.querySelector('#address-0');
      if (!addressDiv) return null;
      return Array.from(addressDiv.querySelectorAll('p')).map(
        (p) => p.textContent?.trim() ?? '',
      );
    });
    const address = paragraphs ? parseCompanyAddress(paragraphs) : null;
    if (!address)
      throw new Error(
        `Could not extract company address from company page: ${companyPageUrl}`,
      );
    return address;
  } finally {
    await companyPage.close();
  }
}
