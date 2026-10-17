// Extrai, do PDF oficial da Tabela 5.2A (cBenef) de Santa Catarina (portal da SEF/SC), cada código
// de benefício com os CST em que vale, a vigência, o tipo (isenção, redução, crédito presumido...)
// e a descrição (F3-27.b.SC). A tabela marca "Sim" sob a coluna do CST: a leitura usa a posição de
// cada pedaço de texto no PDF. Crédito presumido não leva CST (vai no cCredPresumido da nota).

const CODE = /^SC\d{6}$/;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const iso = (t) => {
  const m = DATE.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** @param items pedaços de texto com posição (pdf-text.mjs, pdfItems) */
export function parseCbenefSc(items) {
  const codes = [];
  for (const page of [...new Set(items.map((i) => i.page))]) {
    const on = items.filter((i) => i.page === page);
    const cstCols = on
      .filter((i) => /^CST \d{2}$/.test(i.str.trim()))
      .map((i) => ({ cst: i.str.trim().slice(4), center: i.x + i.width / 2 }));
    const codeHead = on.find((i) => /^Código do benefício/.test(i.str.trim()));
    const startHead = on.find((i) => /^Vigência Início/.test(i.str.trim()));
    const endHead = on.find((i) => /^Vigência Fim/.test(i.str.trim()));
    const lawHead = on.find((i) => i.str.trim() === 'Legislação');
    if (cstCols.length < 10 || !codeHead || !startHead || !endHead || !lawHead) continue;
    const headY = codeHead.y;
    const firstCst = Math.min(...cstCols.map((c) => c.center)) - 15;
    const rows = on
      .filter((i) => CODE.test(i.str.trim()) && i.y < headY)
      .sort((a, b) => b.y - a.y)
      .map((r) => ({ item: r, words: [], kind: [] }));
    // Cada linha vai do meio do caminho até a de cima ao meio do caminho até a de baixo (o código
    // fica no centro da célula).
    rows.forEach((r, k) => {
      r.top = k === 0 ? headY - 3 : (rows[k - 1].item.y + r.item.y) / 2;
      r.bottom = k === rows.length - 1 ? -Infinity : (r.item.y + rows[k + 1].item.y) / 2;
    });
    const bandOf = (y) => rows.find((r) => y <= r.top && y > r.bottom) ?? null;
    const tributoHead = on.find((i) => i.str.trim() === 'Tributo');
    const descHead = on.find((i) => i.str.trim() === 'Descrição');
    const simplesHead = on.find((i) => i.str.trim() === 'Simples');
    for (const row of rows) {
      const same = on.filter((i) => Math.abs(i.y - row.item.y) < 1.5);
      row.csts = [
        ...new Set(
          same
            .filter((i) => i.str.trim() === 'Sim' && i.x > firstCst && i.x < lawHead.x - 5)
            .map((i) => {
              const c = i.x + i.width / 2;
              return cstCols.reduce((b, col) =>
                Math.abs(col.center - c) < Math.abs(b.center - c) ? col : b,
              ).cst;
            }),
        ),
      ].sort();
      const start = same.find((i) => DATE.test(i.str.trim()) && Math.abs(i.x - startHead.x) < 15);
      const end = same.find((i) => DATE.test(i.str.trim()) && Math.abs(i.x - endHead.x) < 15);
      row.from = start ? iso(start.str.trim()) : null;
      row.to = end ? iso(end.str.trim()) : null;
    }
    // Descrição (colunas da esquerda, antes do "Aplica ao Simples") e tipo do benefício.
    for (const i of on) {
      if (i.y >= headY - 3) continue;
      // Rodapé da página: data e hora em que a SEF gerou o arquivo e "Página x de y".
      if (/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/.test(i.str.trim()) || /^Página \d+/.test(i.str.trim()))
        continue;
      const r = bandOf(i.y);
      if (!r) continue;
      if (tributoHead && i.x < tributoHead.x - 2) r.kind.push(i);
      else if (descHead && simplesHead && i.x >= descHead.x - 2 && i.x < simplesHead.x - 3)
        r.words.push(i);
    }
    for (const r of rows) {
      const text = (list) =>
        list
          .sort((a, b) => b.y - a.y || a.x - b.x)
          .map((w) => w.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      codes.push({
        code: r.item.str.trim(),
        csts: r.csts,
        from: r.from,
        to: r.to,
        kind: ((k) => k.charAt(0).toUpperCase() + k.slice(1))(text(r.kind).replace(/^- -$/, '')),
        description: text(r.words),
      });
    }
  }
  if (codes.length < 100)
    throw new Error(`Esperava a Tabela 5.2A de SC inteira; achei ${codes.length} códigos`);
  return codes;
}
