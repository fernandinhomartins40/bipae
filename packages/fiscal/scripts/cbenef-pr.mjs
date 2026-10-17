// Leitor das tabelas oficiais de cBenef em PDF no formato "código × CST" (F3-27.b): Paraná
// ("Tabela de Códigos de Benefício Fiscal por CST", Portal SPED da SEFA-PR) e Rio de Janeiro
// ("Tabela de códigos de benefício X CST", portal do DF-e da SEFAZ-RJ). A tabela marca "SIM" sob a
// coluna do CST: a leitura usa a posição de cada pedaço de texto no PDF. Nada é digitado à mão.

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const iso = (text) => {
  const m = DATE.exec(text);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

const isHead = (i, names) => names.includes(i.str.trim());

/**
 * @param items pedaços de texto com posição (pdf-text.mjs, pdfItems)
 * @param options código da UF, mínimo de códigos esperado e se aceita código sem CST
 */
export function parseCbenefByCst(items, { uf, min, allowNoCst = false }) {
  const CODE = new RegExp(`^(${uf}\\d{6}|SEM CBENEF)$`, 'i');
  const codes = [];
  let layout = null; // cabeçalho da última página que o trouxe
  for (const page of [...new Set(items.map((i) => i.page))]) {
    const on = items.filter((i) => i.page === page);
    // Cabeçalho: "CST 00" ... "CST 90", início e fim da vigência, descrição (e observação). Algumas
    // tabelas só o trazem na primeira página: as outras usam o mesmo.
    const cols = on
      .filter((i) => /^CST \d{2}$/.test(i.str.trim()))
      .map((i) => ({ cst: i.str.trim().slice(4), center: i.x + i.width / 2 }));
    const head = {
      cstCols: cols,
      start: on.find((i) => isHead(i, ['DT INÍCIO', 'DATA INÍCIO'])),
      end: on.find((i) => isHead(i, ['DT FINAL', 'DATA FIM'])),
      desc: on.find((i) => isHead(i, ['DESCRIÇÃO'])),
      obs: on.find((i) => isHead(i, ['OBSERVAÇÃO'])),
      headY: on.find((i) => i.str.trim() === 'CST 00')?.y,
    };
    const found = cols.length >= 10 && head.start && head.end && head.desc;
    if (found) layout = head;
    if (!layout) continue;
    const { cstCols, start, end, obs } = layout;
    const headY = found ? head.headY : Infinity;
    const descFrom = end.x + end.width + 5; // a descrição começa depois das datas
    const descTo = obs ? obs.x - 5 : Infinity;
    const rows = on.filter((i) => CODE.test(i.str.trim()) && i.y < headY).sort((a, b) => b.y - a.y);
    for (const row of rows) {
      const same = on.filter((i) => Math.abs(i.y - row.y) < 1.5);
      const csts = same
        .filter((i) => i.str.trim().toUpperCase() === 'SIM' && i.x < start.x - 5)
        .map((i) => {
          const c = i.x + i.width / 2;
          return cstCols.reduce((best, col) =>
            Math.abs(col.center - c) < Math.abs(best.center - c) ? col : best,
          ).cst;
        });
      const dates = same.filter((i) => DATE.test(i.str.trim())).sort((a, b) => a.x - b.x);
      const from = dates.find((d) => d.x < (start.x + end.x) / 2);
      const to = dates.find((d) => d.x >= (start.x + end.x) / 2 && d.x < descFrom);
      codes.push({
        code: row.str.trim().toUpperCase(),
        y: row.y,
        page,
        csts: [...new Set(csts)].sort(),
        from: from ? iso(from.str.trim()) : null,
        to: to ? iso(to.str.trim()) : null,
        words: [],
      });
    }
    // Descrição: cada pedaço entre as datas e a observação vai para a linha de código mais próxima.
    const pageRows = codes.filter((c) => c.page === page);
    for (const i of on) {
      if (i.x < descFrom - 10 || i.x >= descTo || i.y >= headY || DATE.test(i.str.trim())) continue;
      if (/^Tabela /.test(i.str) || /^\d+$/.test(i.str.trim())) continue;
      let best = null;
      for (const r of pageRows) if (!best || Math.abs(r.y - i.y) < Math.abs(best.y - i.y)) best = r;
      if (best && Math.abs(best.y - i.y) < 30) best.words.push(i);
    }
  }
  const result = codes.map(({ y: _y, page: _p, words, ...c }) => ({
    ...c,
    description: words
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((w) => w.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  }));
  if (result.length < min) {
    throw new Error(`Esperava a tabela cBenef de ${uf} inteira; achei ${result.length} códigos`);
  }
  const noCst = result.filter((c) => c.code !== 'SEM CBENEF' && c.csts.length === 0);
  if (!allowNoCst && noCst.length > 0) {
    throw new Error(
      `Códigos sem CST na tabela de ${uf}: ${noCst
        .slice(0, 5)
        .map((c) => c.code)
        .join(', ')}`,
    );
  }
  return result;
}

/** Paraná: todos os códigos têm CST. */
export const parseCbenefPr = (items) => parseCbenefByCst(items, { uf: 'PR', min: 300 });

/**
 * Rio de Janeiro: alguns códigos (suspensão, ampliação de prazo, inexigibilidade de estorno) não
 * marcam CST na tabela.
 */
export const parseCbenefRj = (items) =>
  parseCbenefByCst(items, { uf: 'RJ', min: 300, allowNoCst: true });
