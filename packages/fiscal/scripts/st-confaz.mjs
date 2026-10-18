// Lê as planilhas do Portal Nacional da Substituição Tributária do CONFAZ (Convênio ICMS 18/2017,
// leiaute do Ato COTEPE/ICMS 12/2018): cada UF declara, por segmento, os CEST em ST nas operações
// internas e a MVA original (F3-26.d). O leiaute é o mesmo, mas cada UF nomeia as colunas do seu
// jeito; a leitura pega a MVA das operações internas e deixa de fora as colunas ajustadas para as
// alíquotas interestaduais. Linha com "Op. Interna" = N (a UF não adota a ST) fica de fora.
// Nenhum valor é digitado à mão.

const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
const fold = (text) => clean(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Coluna de MVA das operações internas (não a ajustada a uma alíquota interestadual). */
function isInternalMva(header) {
  const h = fold(header);
  if (/^origem: /.test(h)) return true; // PI: MVA por tipo de remetente
  if (!/\bmvas?\b/.test(h)) return false;
  return !/interestadual|aliquota de (4|7|12)%|ajustada|signatario|importacao|origem (4|7|12)%|especifica/.test(
    h,
  );
}

/** 0.7178 → "71,78"; "40%" → "40". */
export function mvaText(value) {
  const text = clean(value);
  if (!text || text === '-') return null;
  const pct = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(text);
  const n = pct ? Number(pct[1].replace(',', '.')) / 100 : Number(text.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 20) return null;
  const value100 = Math.round(n * 10_000) / 100;
  return value100.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

/** "Produção de efeitos a partir de 08/03/2023" → "2023-03-08". */
const effectsOf = (rows) => {
  for (const row of rows.slice(0, 6)) {
    const m = /efeitos a partir de (\d{2})\/(\d{2})\/(\d{4})/i.exec(row.map(clean).join(' '));
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
};

/**
 * Lê as abas de uma planilha. `known` são os CEST do Convênio ICMS 142/2018. Devolve uma entrada
 * por aba, com os itens (CEST, NCM, descrição, MVA e rótulo quando há mais de uma MVA).
 */
export function parseConfazSt(sheets, { known }) {
  const out = [];
  // Aba sem a data no cabeçalho usa a da planilha (a primeira que tiver).
  const workbookFrom = sheets.map((s) => effectsOf(s.rows)).find(Boolean) ?? null;

  for (const sheet of sheets) {
    if (/leiaute|estudo/i.test(sheet.name)) continue;
    const rows = sheet.rows;
    const at = rows.findIndex((r) => r.some((c) => fold(c) === 'cest'));
    if (at < 0) continue;
    const header = rows[at].map(clean);
    const col = (test) => header.findIndex((h) => test(fold(h)));
    const cestCol = col((h) => h === 'cest');
    const ncmCol = col((h) => h.startsWith('ncm'));
    const itemCol = col((h) => h === 'item');
    const descCol = col((h) => h.startsWith('descri'));
    const internalCol = col((h) => h.startsWith('op. interna'));
    const above = rows[at - 1]?.map(clean) ?? [];
    const groupLabel = (index) => {
      // Título do grupo na linha de cima ("Regra Geral", "Índice Fidelização"), à esquerda.
      for (let i = index; i >= 0; i--) {
        if (above[i] && !/^(observa|anexo|tabela)|segmento/i.test(above[i])) return above[i];
      }
      return null;
    };
    const mvaCols = header
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => isInternalMva(h))
      .map(({ h, i }) => {
        const spec = fold(header[i + 1] ?? '').startsWith('especifica') ? i + 1 : -1;
        return { i, header: h, spec, group: groupLabel(i) };
      });
    const validFrom = effectsOf(rows) ?? workbookFrom;
    const items = [];
    const unknown = new Set();
    let excluded = 0;
    if (mvaCols.length > 0 && cestCol >= 0) {
      for (const row of rows.slice(at + 1)) {
        const digits = clean(row[cestCol]).replace(/\D/g, '');
        if (digits.length < 6) continue;
        const cest = digits.padStart(7, '0');
        if (internalCol >= 0 && fold(row[internalCol]) === 'n') {
          excluded++;
          continue;
        }
        if (!known.has(cest)) {
          unknown.add(cest);
          continue;
        }
        const values = mvaCols.map((m) => ({ ...m, mva: mvaText(row[m.i]) })).filter((m) => m.mva);
        for (const m of values) {
          const label =
            values.length > 1 || mvaCols.length > 1
              ? clean(m.spec >= 0 ? row[m.spec] : '') || m.group || m.header
              : null;
          items.push({
            item: clean(row[itemCol]),
            cest,
            ncms: clean(row[ncmCol])
              .split(/\s+/)
              .map((t) => t.replace(/\D/g, ''))
              .filter((t) => t.length >= 2),
            description: clean(row[descCol]),
            label: label && !/^-$/.test(label) ? label : null,
            mva: m.mva,
          });
        }
      }
    }
    out.push({
      name: clean(sheet.name),
      title: clean(
        rows
          .slice(0, at)
          .flat()
          .find((c) => /segmento/i.test(String(c))) ?? sheet.name,
      ),
      validFrom,
      items,
      unknown: [...unknown].sort(),
      excluded,
      withoutMva: mvaCols.length === 0,
    });
  }
  // Duas abas com as mesmas linhas (erro de cópia na planilha da UF): fica a aba cujo título
  // combina com a descrição dos itens.
  const signature = (s) => s.items.map((i) => `${i.cest}|${i.mva}`).join(',');
  const words = (text) =>
    new Set(
      fold(text)
        .split(/[^a-z]+/)
        .filter((w) => w.length >= 5)
        .map((w) => w.slice(0, 6)),
    );
  const matches = (s) => {
    const title = words(`${s.title} ${s.name}`);
    return s.items.some((i) => [...words(i.description)].some((w) => title.has(w)));
  };
  return out.filter((s) => {
    if (s.items.length === 0) return true;
    const twins = out.filter((o) => o !== s && signature(o) === signature(s));
    return twins.length === 0 || matches(s);
  });
}

/** No formato de st-references.json. */
export function confazStReferences(parsed, { uf, url, source, act, segmentName }) {
  const references = parsed
    .filter((s) => s.items.length > 0)
    .map((s) => {
      // Uma linha por CEST, rótulo e MVA, juntando os NCM.
      const byKey = new Map();
      for (const i of s.items) {
        const key = `${i.cest}|${i.label ?? ''}|${i.mva}`;
        const found = byKey.get(key);
        if (found) {
          for (const n of i.ncms) if (!found.ncms.includes(n)) found.ncms.push(n);
        } else byKey.set(key, { ...i, ncms: [...i.ncms] });
      }
      const lines = [...byKey.values()];
      const code = lines[0].cest.slice(0, 2);
      return {
        uf,
        segment: `${code}/${s.name}`,
        segmentName: segmentName(code),
        act: `${act}, aba "${s.name}"`,
        source,
        url,
        validFrom: s.validFrom ?? '2018-01-01',
        validTo: null,
        note: `MVA original das operações internas declarada pela UF no Portal Nacional da Substituição Tributária (CONFAZ, Convênio ICMS 18/2017). As MVAs ajustadas para as entradas interestaduais ficam de fora. Onde há mais de uma MVA, a descrição diz qual é.`,
        items: lines.map((l) => {
          const variants = lines.filter((o) => o.cest === l.cest);
          return {
            item: variants.length > 1 ? `${l.item}/${variants.indexOf(l) + 1}` : l.item,
            cest: l.cest,
            ncms: l.ncms,
            description: l.label ? `${l.description} — ${l.label}` : l.description,
            mva: l.mva,
          };
        }),
      };
    });
  const annexes = references.map((r) => ({
    annex: r.segment,
    name: r.segmentName,
    cests: [...new Map(r.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
      ncms.length > 0 ? { cest, ncms } : { cest },
    ),
  }));
  return { segment: { uf, act, source, url, annexes }, references };
}
