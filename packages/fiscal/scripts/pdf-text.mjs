// Texto de um PDF oficial, linha a linha, na ordem do conteúdo (como o pdftotext -raw).
// Usa o pdfjs-dist, para a geração das tabelas não depender de programa instalado na máquina.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const multiply = (a, b) => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

/**
 * Traços finos pintados de cor escura na página (riscos de texto tachado, sublinhados e bordas de
 * tabela), já na coordenada da página.
 */
async function thinBars(page) {
  const ops = await page.getOperatorList();
  const bars = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let dark = true;
  let pending = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = multiply(ctm, args);
    else if (fn === OPS.setFillRGBColor) {
      // O pdfjs entrega a cor em 0 a 255 (ou já como "#rrggbb").
      const rgb =
        typeof args[0] === 'string'
          ? [1, 3, 5].map((k) => parseInt(args[0].slice(k, k + 2), 16))
          : [...args].slice(0, 3);
      dark = rgb.every((c) => c < 128);
    } else if (fn === OPS.setFillGray) dark = args[0] < 0.5;
    else if (fn === OPS.constructPath) {
      const [kinds, coords] = args;
      pending = [];
      if (kinds.every((k) => k === OPS.rectangle)) {
        for (let k = 0; k < kinds.length; k++) {
          const [x, y, w, h] = coords.slice(k * 4, k * 4 + 4);
          const [a, b, c, d, e, f] = ctm;
          const x0 = a * x + c * y + e;
          const y0 = b * x + d * y + f;
          const x1 = a * (x + w) + c * (y + h) + e;
          const y1 = b * (x + w) + d * (y + h) + f;
          pending.push({
            left: Math.min(x0, x1),
            right: Math.max(x0, x1),
            bottom: Math.min(y0, y1),
            top: Math.max(y0, y1),
          });
        }
      }
    } else if (fn === OPS.fill || fn === OPS.eoFill) {
      if (dark) {
        for (const r of pending) if (r.top - r.bottom < 1.5 && r.right - r.left > 1) bars.push(r);
      }
      pending = [];
    }
  }
  return bars;
}

/**
 * Pedaço de texto tachado: um traço fino passa por cima dele, entre a linha de base e a metade da
 * altura da letra, cobrindo a maior parte da largura (o sublinhado fica abaixo da linha de base, e
 * a borda de tabela, acima da letra).
 */
function isStruck(item, bars) {
  const [, , c, d, x, y] = item.transform;
  const size = Math.hypot(c, d) || item.height || 10;
  if (!(item.width > 0)) return false;
  let covered = 0;
  for (const bar of bars) {
    const mid = (bar.top + bar.bottom) / 2;
    if (mid <= y + size * 0.1 || mid >= y + size * 0.5) continue;
    covered += Math.max(0, Math.min(bar.right, x + item.width) - Math.max(bar.left, x));
  }
  return covered > item.width * 0.5;
}

/**
 * Linhas de texto de cada página, juntando os pedaços que estão na mesma altura. Com
 * `withoutStruck`, o texto tachado (redação anterior que a SEFAZ deixa riscada no texto
 * consolidado) fica de fora.
 */
export async function pdfLines(bytes, { withoutStruck = false } = {}) {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const bars = withoutStruck ? await thinBars(page) : [];
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
      const str = withoutStruck && item.str.trim() && isStruck(item, bars) ? '' : item.str;
      // Espaço só quando há folga entre os pedaços (o PDF às vezes parte uma palavra em dois).
      const gap = lastEnd === null ? 0 : x - lastEnd;
      current +=
        (current && gap > 1 && !current.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
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

/** Pedaços de texto com a posição na página (para tabelas em que a coluna importa). */
export async function pdfItems(bytes) {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  const items = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      items.push({
        page: p,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        str: item.str,
      });
    }
    page.cleanup();
  }
  await doc.destroy();
  return items;
}
