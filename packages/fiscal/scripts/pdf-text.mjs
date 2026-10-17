// Texto de um PDF oficial, linha a linha, na ordem do conteúdo (como o pdftotext -raw).
// Usa o pdfjs-dist, para a geração das tabelas não depender de programa instalado na máquina.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Linhas de texto de cada página, juntando os pedaços que estão na mesma altura. */
export async function pdfLines(bytes) {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let current = '';
    let lastY = null;
    let lastEnd = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim());
        current = '';
        lastEnd = null;
      }
      const x = item.transform[4];
      // Espaço só quando há folga entre os pedaços (o PDF às vezes parte uma palavra em dois).
      const gap = lastEnd === null ? 0 : x - lastEnd;
      current +=
        (current && gap > 1 && !current.endsWith(' ') && !item.str.startsWith(' ') ? ' ' : '') +
        item.str;
      lastEnd = x + item.width;
      lastY = y;
      if (item.hasEOL) {
        if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim());
        current = '';
        lastY = null;
        lastEnd = null;
      }
    }
    if (current.trim()) lines.push(current.replace(/\s+/g, ' ').trim());
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}
