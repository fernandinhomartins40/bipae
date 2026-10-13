import QRCode from 'qrcode';
import type { ReceiptBlock } from './escpos';

/** Quadradinhos do QR Code (true = preto), nível de correção M, como na impressora. */
export function qrMatrix(data: string): boolean[][] {
  const { modules } = QRCode.create(data, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, row) =>
    Array.from({ length: modules.size }, (_, col) => modules.get(row, col) === 1),
  );
}

/**
 * QR Code em SVG, com a margem de segurança de 4 quadradinhos. O tamanho físico vem de quem
 * desenha (`sizeMm`): o manual do DANFE NFC-e pede no mínimo 25 mm × 25 mm.
 */
export function qrSvg(data: string, sizeMm = 30): string {
  const matrix = qrMatrix(data);
  const quiet = 4;
  const side = matrix.length + quiet * 2;
  let path = '';
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" ` +
    `width="${sizeMm}mm" height="${sizeMm}mm" shape-rendering="crispEdges" role="img" ` +
    `aria-label="QR Code da consulta da nota"><rect width="${side}" height="${side}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

/**
 * Os mesmos blocos do cupom em HTML, para a tela e para a impressão pelo navegador (que não
 * fala ESC/POS). Texto em fonte monoespaçada na largura do papel; o QR Code vira SVG.
 */
export function receiptToHtml(blocks: ReceiptBlock[], columns: number): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'feed') {
      parts.push('<div class="bipae-feed">&nbsp;</div>'.repeat(block.lines));
      continue;
    }
    if (block.kind === 'qrcode') {
      parts.push(`<div class="bipae-qr" style="text-align:center">${qrSvg(block.data)}</div>`);
      continue;
    }
    const style = [
      `text-align:${block.align ?? 'left'}`,
      block.bold && 'font-weight:bold',
      block.large && 'font-size:1.6em',
    ]
      .filter(Boolean)
      .join(';');
    for (const line of block.text.split('\n')) {
      parts.push(`<div style="${style}">${escapeHtml(line) || '&nbsp;'}</div>`);
    }
  }
  return (
    `<div class="bipae-receipt" style="font:12px/1.35 monospace;width:${columns}ch;` +
    `max-width:100%;white-space:pre-wrap;word-break:break-word;color:#000;background:#fff;` +
    `padding:2mm">${parts.join('')}</div>`
  );
}
