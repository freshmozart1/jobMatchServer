import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const emulateMediaType = jest.fn<(media: string) => Promise<void>>();
const setContent =
    jest.fn<(html: string, options: { waitUntil: string }) => Promise<void>>();
const evaluate = jest.fn<() => Promise<boolean>>();
const pdf = jest.fn<(options: { format: string }) => Promise<Uint8Array>>();
const closePage = jest.fn<() => Promise<void>>();
const closeBrowser = jest.fn<() => Promise<void>>();
const page = { emulateMediaType, setContent, evaluate, pdf, close: closePage };
const newPage = jest.fn<() => Promise<typeof page>>();
const launch =
    jest.fn<
        () => Promise<{ newPage: typeof newPage; close: typeof closeBrowser }>
    >();

jest.unstable_mockModule('puppeteer', () => ({ default: { launch } }));
const { renderCoverLetterPdf } = await import('./coverLetterPdf.js');

const html = '<div class="body"><p>Synthetic normal letter</p></div>';
const pdfBytes = new Uint8Array([37, 80, 68, 70]);

describe('renderCoverLetterPdf', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        emulateMediaType.mockResolvedValue();
        setContent.mockResolvedValue();
        evaluate.mockResolvedValue(false);
        pdf.mockResolvedValue(pdfBytes);
        closePage.mockResolvedValue();
        closeBrowser.mockResolvedValue();
        newPage.mockResolvedValue(page);
        launch.mockResolvedValue({ newPage, close: closeBrowser });
    });

    it('checks print layout before generating a normal PDF and closes resources', async () => {
        await expect(renderCoverLetterPdf(html)).resolves.toBe(pdfBytes);

        expect(emulateMediaType).toHaveBeenCalledWith('print');
        expect(setContent).toHaveBeenCalledWith(html, { waitUntil: 'load' });
        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(pdf).toHaveBeenCalledWith({ format: 'A4' });
        expect(emulateMediaType.mock.invocationCallOrder[0]).toBeLessThan(
            setContent.mock.invocationCallOrder[0]!,
        );
        expect(setContent.mock.invocationCallOrder[0]).toBeLessThan(
            evaluate.mock.invocationCallOrder[0]!,
        );
        expect(evaluate.mock.invocationCallOrder[0]).toBeLessThan(
            pdf.mock.invocationCallOrder[0]!,
        );
        expect(closePage).toHaveBeenCalledTimes(1);
        expect(closeBrowser).toHaveBeenCalledTimes(1);
    });

    it('rejects layout overflow before producing PDF bytes and still closes resources', async () => {
        evaluate.mockResolvedValue(true);
        await expect(renderCoverLetterPdf(html)).rejects.toMatchObject({
            name: 'CoverLetterOverflowError',
            message:
                'Cover letter text does not fit on one page. Shorten the letter and try downloading again.',
        });
        expect(pdf).not.toHaveBeenCalled();
        expect(closePage).toHaveBeenCalledTimes(1);
        expect(closeBrowser).toHaveBeenCalledTimes(1);
    });

    it.each([
        { name: 'media setup', mock: emulateMediaType },
        { name: 'HTML loading', mock: setContent },
        { name: 'layout evaluation', mock: evaluate },
        { name: 'PDF generation', mock: pdf },
    ])(
        'preserves a genuine $name error and closes resources',
        async ({ mock }) => {
            const error = new Error('Synthetic renderer failure');
            mock.mockRejectedValue(error);
            await expect(renderCoverLetterPdf(html)).rejects.toBe(error);
            expect(closePage).toHaveBeenCalledTimes(1);
            expect(closeBrowser).toHaveBeenCalledTimes(1);
        },
    );

    it('closes the browser when creating its page fails', async () => {
        const error = new Error('Synthetic new-page failure');
        newPage.mockRejectedValue(error);
        await expect(renderCoverLetterPdf(html)).rejects.toBe(error);
        expect(closePage).not.toHaveBeenCalled();
        expect(closeBrowser).toHaveBeenCalledTimes(1);
    });
});
