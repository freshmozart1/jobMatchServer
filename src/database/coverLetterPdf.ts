import { readFileSync } from 'fs';
import puppeteer from 'puppeteer';
import type {
  CoverLetterSegmentName,
  StoredCoverLetter,
  StoredScrapedJob,
  StoredUser,
} from '#types';

const BODY_SEGMENT_ORDER: CoverLetterSegmentName[] = [
  'salutation',
  'introduction',
  'mainBody',
  'conclusion',
  'greetings',
];

const coverLetterTemplate = readFileSync(
  new URL('./coverLetter.html', import.meta.url),
  'utf-8',
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function coverLetterToHtml(
  coverLetter: StoredCoverLetter,
  job: StoredScrapedJob,
  user: StoredUser,
): string {
  const date = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const bodyParas = BODY_SEGMENT_ORDER.flatMap((name) =>
    coverLetter[name].text ? coverLetter[name].text.split('\n\n') : [],
  )
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return coverLetterTemplate
    .replace(/\{\{userName\}\}/g, () => escapeHtml(user.name))
    .replace(/\{\{userStreetAddress\}\}/g, () =>
      escapeHtml(user.address.streetAddress),
    )
    .replace(/\{\{userPostalCode\}\}/g, () =>
      escapeHtml(user.address.postalCode),
    )
    .replace(/\{\{userCity\}\}/g, () => escapeHtml(user.address.city))
    .replace(/\{\{userTel\}\}/g, () => escapeHtml(user.tel))
    .replace(/\{\{userEmail\}\}/g, () => escapeHtml(user.email))
    .replace(/\{\{jobCompany\}\}/g, () => escapeHtml(job.company))
    .replace(/\{\{jobStreetAddress\}\}/g, () =>
      escapeHtml(job.companyAddress.streetAddress),
    )
    .replace(/\{\{jobPostalCode\}\}/g, () =>
      escapeHtml(job.companyAddress.postalCode),
    )
    .replace(/\{\{jobCity\}\}/g, () => escapeHtml(job.companyAddress.city))
    .replace(/\{\{date\}\}/g, () => escapeHtml(date))
    .replace(/\{\{subject\}\}/g, () => escapeHtml(coverLetter.subject.text))
    .replace(/\{\{bodyParas\}\}/g, () => bodyParas);
}

export async function renderCoverLetterPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4' });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
