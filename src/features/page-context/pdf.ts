import type { PDFDocumentProxy } from 'pdfjs-dist';
import * as v from 'valibot';

const textItemSchema = v.object({ str: v.string(), hasEOL: v.exactOptional(v.boolean()) });

export interface ExtractedPdf {
  name: string;
  pages: Array<{ page: number; text: string }>;
  pageCount: number;
  emptyPages: number[];
  truncated: boolean;
}

export async function extractPdfText(
  file: File,
  options: { signal?: AbortSignal; maxPages?: number; maxCharacters?: number } = {},
): Promise<ExtractedPdf> {
  const { signal, maxPages = 100, maxCharacters = 120_000 } = options;
  signal?.throwIfAborted();
  if (!file.size || file.size > 25 * 1024 * 1024)
    throw new Error('请选择不超过 25 MB 的 PDF 文件。');
  if (
    !Number.isInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 100 ||
    !Number.isInteger(maxCharacters) ||
    maxCharacters < 1 ||
    maxCharacters > 120_000
  )
    throw new Error('PDF 提取范围无效。');
  const data = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-')
    throw new Error('文件没有有效的 PDF 标识。');
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  signal?.throwIfAborted();
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    useWasm: false,
    stopAtErrors: true,
  });
  const cancel = () => {
    void task.destroy();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  let document: PDFDocumentProxy | undefined;
  try {
    document = await task.promise;
    signal?.throwIfAborted();
    const result: ExtractedPdf = {
      name: file.name,
      pages: [],
      pageCount: document.numPages,
      emptyPages: [],
      truncated: document.numPages > maxPages,
    };
    let remaining = maxCharacters;
    for (let number = 1; number <= Math.min(maxPages, document.numPages); number++) {
      signal?.throwIfAborted();
      if (!remaining) {
        result.truncated = true;
        break;
      }
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => {
          const parsed = v.safeParse(textItemSchema, item);
          return parsed.success ? [parsed.output.str + (parsed.output.hasEOL ? '\n' : ' ')] : [];
        })
        .join('')
        .trim();
      if (!text) result.emptyPages.push(number);
      if (text.length > remaining) result.truncated = true;
      result.pages.push({ page: number, text: text.slice(0, remaining) });
      remaining -= Math.min(remaining, text.length);
      page.cleanup();
    }
    if (result.pages.every((page) => !page.text))
      throw new Error(
        'PDF 没有可提取的文字层，可能是扫描件。尚未配置 OCR；可上传原文件交给支持 PDF 的助手。',
      );
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof Error && error.name === 'PasswordException')
      throw new Error('此 PDF 需要密码，请先在本机解锁后再选择文件。');
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    await task.destroy();
  }
}

export function pdfTextFile(pdf: ExtractedPdf): File {
  const header = [
    `来源文件：${pdf.name}`,
    `PDF 页数：${pdf.pageCount}；提取页数：${pdf.pages.length}`,
    ...(pdf.truncated ? ['注意：提取已达到页数或字符上限，仅包含部分内容。'] : []),
    ...(pdf.emptyPages.length
      ? [`没有文字层的页码：${pdf.emptyPages.join('、')}（未执行 OCR）`]
      : []),
  ];
  const text = [
    ...header,
    ...pdf.pages.map(
      (page) => `\n[第 ${page.page} 页]\n${page.text || '此页没有可读取的文字层。'}`,
    ),
  ].join('\n');
  return new File([text], `${pdf.name}.txt`, { type: 'text/plain' });
}
