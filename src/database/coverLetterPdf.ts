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
  const isDraft = coverLetter.coverLetterText !== undefined;
  const bodyParas = isDraft
    ? escapeHtml(coverLetter.coverLetterText ?? '')
    : BODY_SEGMENT_ORDER.flatMap((name) =>
        coverLetter[name].text ? coverLetter[name].text.split('\n\n') : [],
      )
        .filter((p) => p.trim())
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
  return coverLetterTemplate
    .replace(/\{\{bodyClass\}\}/g, () => (isDraft ? 'body draft' : 'body'))
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
      escapeHtml(job.companyAddresses[0]?.streetAddress ?? ''),
    )
    .replace(/\{\{jobPostalCode\}\}/g, () =>
      escapeHtml(job.companyAddresses[0]?.postalCode ?? ''),
    )
    .replace(/\{\{jobCity\}\}/g, () =>
      escapeHtml(job.companyAddresses[0]?.city ?? ''),
    )
    .replace(/\{\{date\}\}/g, () => escapeHtml(date))
    .replace(/\{\{subject\}\}/g, () =>
      escapeHtml(isDraft ? '' : coverLetter.subject.text),
    )
    .replace(/\{\{bodyParas\}\}/g, () => bodyParas);
}

export class CoverLetterOverflowError extends Error {
  constructor() {
    super(
      'Cover letter text does not fit on one page. Shorten the letter and try downloading again.',
    );
    this.name = 'CoverLetterOverflowError';
  }
}

export async function renderCoverLetterPdf(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    try {
      await page.emulateMediaType('print');
      await page.setContent(html, { waitUntil: 'load' });
      const overflows = await page.evaluate(async () => {
        await document.fonts.ready;
        const body = document.querySelector('.body');
        if (!body) throw new Error('Cover letter body container not found');

        const bounds = body.getBoundingClientRect();
        const content = document.createRange();
        content.selectNodeContents(body);
        // Compare content boxes, excluding paragraph margins. Half a CSS pixel
        // tolerates subpixel rounding without permitting a clipped line.
        const epsilon = 0.5;
        return Array.from(content.getClientRects()).some(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            (rect.top < bounds.top - epsilon ||
              rect.bottom > bounds.bottom + epsilon ||
              rect.left < bounds.left - epsilon ||
              rect.right > bounds.right + epsilon),
        );
      });
      if (overflows) throw new CoverLetterOverflowError();
      return await page.pdf({ format: 'A4' });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
