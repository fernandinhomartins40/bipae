// Extrai, das planilhas do Anexo 5 do RICMS/PB publicadas pela SEFAZ-PB (uma por segmento), as
// mercadorias em substituição tributária e a MVA original de cada CEST (F3-26.d.PB). Cada linha
// traz a vigência; vale a linha em vigor na data em que a planilha foi baixada. Nenhum valor é
// digitado à mão.

/** Número de série do Excel (dias desde 30/12/1899) → "AAAA-MM-DD". */
export function isoFromExcel(serial) {
  // Algumas células vêm como texto ("27/03 2020").
  const text = /^(\d{1,2})\/(\d{1,2})[/ ](\d{4})$/.exec(String(serial ?? '').trim());
  if (text) return `${text[3]}-${text[2].padStart(2, '0')}-${text[1].padStart(2, '0')}`;
  const n = Number(serial);
  if (!serial || !Number.isFinite(n)) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0.7178 → "71,78"; 1 → "100" (o formato da tabela de referências). */
export function mvaFromFraction(text) {
  const n = Number(String(text).replace(',', '.'));
  if (!String(text).trim() || !Number.isFinite(n)) return null;
  const pct = Math.round(n * 10_000) / 100;
  return pct.toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Lê uma planilha. `rows` é a primeira aba (lista de linhas); `known` são os CEST da tabela do
 * Convênio ICMS 142/2018; `date` é a data da leitura.
 */
export function parsePbSheet(rows, { known, date, name }) {
  const header = rows[0]?.map(fold) ?? [];
  const col = (test) => header.findIndex(test);
  const cestCol = col((h) => h === 'cest');
  const ncmCol = col((h) => h.startsWith('ncm'));
  const itemCol = col((h) => h === 'item' || h === 'tem');
  const fromCol = col((h) => h.startsWith('vigencia inicial'));
  const toCol = col((h) => h.startsWith('vigencia final'));
  const descCol = col((h) => h.startsWith('descri'));
  const pautaCol = col((h) => h.startsWith('pauta'));
  const lawCol = col((h) => h.startsWith('legisla'));
  // MVA original: uma coluna, ou duas nas autopeças (sem e com índice de fidelidade).
  const mvaCols = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^mva original/.test(h))
    .map(({ h, i }) => ({
      i,
      label: /c\/ ?fid/.test(h)
        ? 'com índice de fidelidade de compra (fabricante de veículos)'
        : /s\/ ?fid/.test(h)
          ? 'demais operações'
          : null,
    }));
  if ([cestCol, ncmCol, fromCol, toCol, descCol].some((c) => c < 0) || mvaCols.length === 0) {
    throw new Error(`Anexo 5 do RICMS/PB (${name}): cabeçalho fora do formato`);
  }
  const lines = [];
  const unknown = new Set();
  let pauta = false;
  for (const row of rows.slice(1)) {
    const cestDigits = String(row[cestCol] ?? '').replace(/\D/g, '');
    if (!cestDigits) continue;
    const cest = cestDigits.padStart(7, '0');
    const from = isoFromExcel(row[fromCol]);
    const to = isoFromExcel(row[toCol]);
    if (!from) throw new Error(`Anexo 5 do RICMS/PB (${name}): CEST ${cest} sem vigência`);
    if (from > date || (to && to < date)) continue;
    // CEST que não está no Convênio ICMS 142/2018 fica de fora (a lista sai no resultado).
    if (!known.has(cest)) {
      unknown.add(cest);
      continue;
    }
    if (pautaCol >= 0 && /pauta/i.test(String(row[pautaCol] ?? ''))) pauta = true;
    for (const { i, label } of mvaCols) {
      const mva = mvaFromFraction(row[i]);
      if (!mva) continue;
      lines.push({
        item: String(row[itemCol] ?? '').trim(),
        cest,
        ncm: String(row[ncmCol] ?? '').replace(/\D/g, ''),
        description: String(row[descCol] ?? '')
          .replace(/\s+/g, ' ')
          .trim(),
        label,
        mva,
        validFrom: from,
        law: lawCol >= 0 ? String(row[lawCol] ?? '').trim() : '',
      });
    }
  }
  // Uma linha por CEST e MVA, com todos os NCM.
  const byKey = new Map();
  for (const l of lines) {
    const key = `${l.cest}|${l.label ?? ''}|${l.mva}`;
    const found = byKey.get(key);
    if (found) {
      if (l.ncm && !found.ncms.includes(l.ncm)) found.ncms.push(l.ncm);
      if (l.validFrom > found.validFrom) found.validFrom = l.validFrom;
    } else {
      byKey.set(key, { ...l, ncms: l.ncm ? [l.ncm] : [] });
    }
  }
  const items = [...byKey.values()];
  return {
    name,
    pauta,
    unknown: [...unknown].sort(),
    items: items.map((i) => {
      const variants = items.filter((o) => o.cest === i.cest);
      const index = variants.indexOf(i);
      return {
        item: variants.length > 1 ? `${i.item}/${index + 1}` : i.item,
        cest: i.cest,
        ncms: i.ncms,
        description: i.label ? `${i.description} — ${i.label}` : i.description,
        mva: i.mva,
      };
    }),
    validFrom: items.reduce((d, i) => (i.validFrom > d ? i.validFrom : d), '0000-00-00'),
  };
}

/** No formato de st-references.json; `segmentName` dá o nome do segmento do CEST. */
export function pbStReferences(sheets, { url, segmentName }) {
  const references = sheets
    .filter((s) => s.items.length > 0)
    .map((s) => {
      const code = s.items[0].cest.slice(0, 2);
      return {
        uf: 'PB',
        segment: code,
        segmentName: segmentName(code),
        act: `RICMS/PB (Decreto 18.930/1997), Anexo 5, planilha "${s.name}"`,
        source: s.source,
        url: s.url ?? url,
        validFrom: s.validFrom,
        validTo: null,
        note: `MVA original das operações internas (a planilha também traz a MVA ajustada para entradas com 4%, 7% e 12%; a SEFAZ-PB manda usar a original para o Simples Nacional).${
          s.pauta
            ? ' Para os produtos marcados com pauta fiscal, a base é o valor da pauta da SEFAZ-PB quando houver.'
            : ''
        } Vale a linha em vigor na data da planilha.`,
        items: s.items,
      };
    });
  const annexes = references.map((r) => ({
    annex: r.segment,
    name: r.segmentName,
    cests: [...new Map(r.items.map((i) => [i.cest, i.ncms])).entries()].map(([cest, ncms]) =>
      ncms.length > 0 ? { cest, ncms } : { cest },
    ),
  }));
  return {
    segment: {
      uf: 'PB',
      act: 'RICMS/PB (Decreto 18.930/1997), Anexo 5 (planilhas da SEFAZ-PB por segmento)',
      source: sheets[0]?.source ?? 'stPbAnexo5',
      url,
      annexes,
    },
    references,
  };
}
