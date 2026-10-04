import { expect, it } from 'vitest';

import { extractPdfText, pdfTextFile } from '../../src/features/page-context/pdf';

function pdfFile() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const stream = 'BT /F1 12 Tf 20 200 Td (Source page text) Tj ET';
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new File([text], 'source.pdf', { type: 'application/pdf' });
}

it('extracts a real PDF through the locally bundled worker and preserves page provenance', async () => {
  const result = await extractPdfText(pdfFile());
  expect(result).toMatchObject({
    name: 'source.pdf',
    pageCount: 1,
    truncated: false,
    emptyPages: [],
    pages: [{ page: 1, text: 'Source page text' }],
  });
  expect(await pdfTextFile(result).text()).toContain('[第 1 页]\nSource page text');
});

it('declares character truncation without claiming the rest was extracted', async () => {
  const result = await extractPdfText(pdfFile(), { maxCharacters: 6 });
  expect(result.truncated).toBe(true);
  expect(result.pages[0]?.text).toBe('Source');
  expect(await pdfTextFile(result).text()).toContain('仅包含部分内容');
});

it('rejects invalid PDF data and aborts before processing cancelled work', async () => {
  await expect(extractPdfText(new File(['plain text'], 'fake.pdf'))).rejects.toThrow('PDF 标识');
  const controller = new AbortController();
  controller.abort();
  await expect(extractPdfText(pdfFile(), { signal: controller.signal })).rejects.toMatchObject({
    name: 'AbortError',
  });
});
