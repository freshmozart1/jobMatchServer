/* global document, getComputedStyle, console */
// Offline acceptance fixture: npm run build, then node scripts/check-cover-letter-draft-pdf.mjs.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { toStoredCoverLetterDraft } from '../dist/coverLetters/coverLetterDraft.js';
import {
  coverLetterToHtml,
  renderCoverLetterPdf,
  CoverLetterOverflowError,
} from '../dist/database/coverLetterPdf.js';

const outputDir = await mkdtemp(path.join(tmpdir(), 'jobmatch-draft-pdf-'));
const user = {
  name: 'Synthetic Applicant', email: 'applicant@example.com', tel: '030 000000',
  address: { streetAddress: 'Teststraße 1', postalCode: '10115', city: 'Berlin', countryCode: 'DE' },
};
const job = {
  title: 'Software Engineer', company: 'Synthetic Company',
  companyAddresses: [{ streetAddress: 'Teststraße 2', postalCode: '10115', city: 'Berlin', countryCode: 'DE' }],
};
const segments = {
  subject: 'Bewerbung als Software Engineer',
  salutation: 'Sehr geehrtes Team,',
  introduction: 'ich bewerbe mich um die ausgeschriebene Position. Ich entwickle TypeScript-Anwendungen und arbeite sorgfältig an zuverlässigen Schnittstellen.',
  mainBody: 'In meinen bisherigen Projekten habe ich Webanwendungen entwickelt, Datenflüsse geprüft und Fehler reproduzierbar behoben. Verständliche Tests und klare Dokumentation unterstützen dabei die Zusammenarbeit.\n\nIch bringe Erfahrung mit Node.js, Datenbanken und Benutzeroberflächen mit. Besonders interessieren mich nachvollziehbare Lösungen, die sich im Alltag gut warten lassen.',
  conclusion: 'Gern erläutere ich meine Erfahrungen in einem persönlichen Gespräch. Ich freue mich auf Ihre Rückmeldung.',
  greetings: 'Freundliche Grüße\nSynthetic Applicant',
};
const rawText = Object.values(segments).join('\n\n');
const legacy = Object.fromEntries(Object.entries(segments).map(([name, text]) => [name, { text, embedding: null }]));
const draft = toStoredCoverLetterDraft(rawText);
const staleDraft = { ...legacy, ...draft, subject: { text: 'STALE SUBJECT MUST NOT RENDER', embedding: [1] } };
const html = coverLetterToHtml(staleDraft, job, user);
assert(!html.includes('STALE SUBJECT MUST NOT RENDER'));

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  try {
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'load' });
    const layout = await page.evaluate(async () => {
      await document.fonts.ready;
      const body = document.querySelector('.body');
      const subject = document.querySelector('.subject');
      assertElement(body);
      assertElement(subject);
      return {
        text: body.textContent,
        draftTop: body.getBoundingClientRect().top,
        subjectTop: subject.getBoundingClientRect().top,
        whiteSpace: getComputedStyle(body).whiteSpace,
      };
      function assertElement(value) { if (!value) throw new Error('Missing template element'); }
    });
    assert.equal(layout.text, rawText);
    assert.equal(layout.whiteSpace, 'pre-wrap');
    assert(Math.abs(layout.draftTop - layout.subjectTop) < 0.5);
    await page.screenshot({ path: path.join(outputDir, 'draft.png'), fullPage: true });
  } finally { await page.close(); }
} finally { await browser.close(); }

for (const [name, letter] of [['draft', staleDraft], ['legacy', legacy]]) {
  const bytes = await renderCoverLetterPdf(coverLetterToHtml(letter, job, user));
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  await writeFile(path.join(outputDir, `${name}.pdf`), bytes);
}
const longText = `${rawText}\n\n${'Overflowing synthetic paragraph.\n\n'.repeat(100)}FINAL SENTINEL`;
await assert.rejects(
  () => renderCoverLetterPdf(coverLetterToHtml(toStoredCoverLetterDraft(longText), job, user)),
  CoverLetterOverflowError,
);
console.log(`Passed: exact latest raw text, no stale duplication, subject-position draft layout, normal raw/legacy one-page PDFs, long-draft overflow. Artifacts: ${outputDir}`);
