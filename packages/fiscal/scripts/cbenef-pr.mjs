// Extrai, do PDF oficial "Tabela de Códigos de Benefício Fiscal por CST" do Paraná (Portal SPED da
// SEFA-PR), cada código de cBenef com os CST em que vale, as datas de início e fim e a descrição
// (F3-27.b). A tabela marca "SIM" sob a coluna do CST: a leitura usa a posição de cada pedaço de
// texto no PDF. Nada é digitado à mão.

const CODE = /^(PR\d{6}|SEM CBENEF)$/;
const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const iso = (text) => {
  const m = DATE.exec(text);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/**
 * @param items pedaços de texto com posição (pdf-text.mjs, pdfItems)
 * @returns códigos com os CST, a vigência e a descrição
 */
export function parseCbenefPr(items) {
  const codes = [];
  const pages = [...new Set(items.map((i) => i.page))];
  for (const page of pages) {
    const on = items.filter((i) => i.page === page);
    // Cabeçalho: "CST 00" ... "CST 90", "DT INÍCIO", "DT FINAL", "DESCRIÇÃO".
    const cstCols = on
      .filter((i) => /^CST \d{2}$/.test(i.str.trim()))
      .map((i) => ({ cst: i.str.trim().slice(4), center: i.x + i.width / 2 }));
    const start = on.find((i) => i.str.trim() === 'DT INÍCIO');
    const end = on.find((i) => i.str.trim() === 'DT FINAL');
    const desc = on.find((i) => i.str.trim() === 'DESCRIÇÃO');
    if (cstCols.length < 10 || !start || !end || !desc) continue;
    const headY = cstCols.length ? on.find((i) => /^CST 00$/.test(i.str.trim())).y : 0;
    const descX = start.x + (end.x - start.x) * 2; // a descrição começa depois das datas
    const rows = on.filter((i) => CODE.test(i.str.trim()) && i.y < headY).sort((a, b) => b.y - a.y);
    for (const row of rows) {
      const same = on.filter((i) => Math.abs(i.y - row.y) < 1.5);
      const csts = same
        .filter((i) => i.str.trim() === 'SIM')
        .map((i) => {
          const c = i.x + i.width / 2;
          return cstCols.reduce((best, col) =>
            Math.abs(col.center - c) < Math.abs(best.center - c) ? col : best,
          ).cst;
        });
      const dates = same.filter((i) => DATE.test(i.str.trim())).sort((a, b) => a.x - b.x);
      const from = dates.find((d) => d.x < (start.x + end.x) / 2);
      const to = dates.find((d) => d.x >= (start.x + end.x) / 2 && d.x < descX);
      codes.push({
        code: row.str.trim(),
        y: row.y,
        page,
        csts: [...new Set(csts)].sort(),
        from: from ? iso(from.str.trim()) : null,
        to: to ? iso(to.str.trim()) : null,
        words: [],
      });
    }
    // Descrição: cada pedaço à direita das datas vai para a linha de código mais próxima.
    const pageRows = codes.filter((c) => c.page === page);
    for (const i of on) {
      if (i.x < descX - 60 || i.y >= headY || DATE.test(i.str.trim())) continue;
      if (/^Tabela de Códigos/.test(i.str) || /^\d+$/.test(i.str.trim())) continue;
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
  if (result.length < 300)
    throw new Error(`Esperava a tabela cBenef do PR inteira; achei ${result.length} códigos`);
  const noCst = result.filter((c) => c.code !== 'SEM CBENEF' && c.csts.length === 0);
  if (noCst.length > 0)
    throw new Error(
      `Códigos sem CST na tabela do PR: ${noCst
        .slice(0, 5)
        .map((c) => c.code)
        .join(', ')}`,
    );
  return result;
}
