// Ceará (F3-26.d.CE): substituição tributária que o Ceará publica por CEST, com a MVA no texto.
//
// O Ceará não tem uma lista única de mercadorias com CEST, NCM e MVA. A ST continua no Livro
// Terceiro do RICMS/CE antigo (Decreto 24.569/1997, texto consolidado do SefazLegis), uma seção por
// segmento, quase todas pela NCM antiga e sem CEST; as MVAs dos regimes de convênio e protocolo
// estão por segmento no Anexo Único da IN 43/2017; e boa parte do comércio está em regimes de
// "carga líquida" por CNAE do comprador (Lei 14.237/2008), que não são MVA por produto.
//
// A única seção com CEST e MVA por CEST é a XXVI (veículos novos, arts. 561 e 562): o caput do
// art. 561 lista os CEST e os §§ 3º e 4º do art. 562 dão a MVA-ST original. Este leitor tira dali
// a redação atual; a data de cada CEST vem da redação anterior do caput (o CEST que já estava lá
// vale desde a data dela). O NCM vem do Convênio ICMS 142/2018 (cest.json). Nada digitado à mão.

const MONTHS = {
  janeiro: '01',
  fevereiro: '02',
  março: '03',
  abril: '04',
  maio: '05',
  junho: '06',
  julho: '07',
  agosto: '08',
  setembro: '09',
  outubro: '10',
  novembro: '11',
  dezembro: '12',
};

/** Data de efeitos da nota ("a partir da data de sua publicação" usa a data do DOE). */
export function effectiveDate(note) {
  const explicit = /a partir de (\d{1,2})(?:\.?º)? de ([a-zç]+) de (\d{4})/i.exec(note);
  if (explicit && MONTHS[explicit[2].toLowerCase()]) {
    return `${explicit[3]}-${MONTHS[explicit[2].toLowerCase()]}-${explicit[1].padStart(2, '0')}`;
  }
  if (/a partir da data de sua publicação/i.test(note)) {
    const doe = /DOE(?: de)? (\d{2})\/(\d{2})\/(\d{4})/.exec(note);
    if (doe) return `${doe[3]}-${doe[2]}-${doe[1]}`;
  }
  return null;
}

/** "25.001.00" → "2500100" */
const cestsIn = (text) =>
  [...text.matchAll(/\b(\d{2})\.(\d{3})\.(\d{2})\b/g)].map((m) => m.slice(1).join(''));

/**
 * Seção XXVI do Livro Terceiro (veículos novos), em versões do caput do art. 561 (a atual primeiro)
 * e as MVAs dos §§ 3º e 4º do art. 562 na redação atual.
 */
export function parseCeVeiculos(lines) {
  const start = lines.findIndex(
    (l, i) => /^SEÇÃO XXVI$/.test(l) && /Veículo Novo/i.test(lines[i + 1] ?? ''),
  );
  if (start < 0) throw new Error('RICMS/CE: não achei a Seção XXVI (veículo novo)');
  let end = lines.findIndex((l, i) => i > start && /^SEÇÃO XXVII$/.test(l));
  if (end < 0) end = lines.length;
  const text = lines.slice(start, end).join(' ').replace(/\s+/g, ' ');

  // Versões do caput do art. 561: cada "Art. 561." com a nota que vem antes dele.
  const versions = [];
  const heads = [...text.matchAll(/Art\. 561\. /g)];
  for (let h = 0; h < heads.length; h++) {
    const before = text.slice(heads[h - 1]?.index ?? 0, heads[h].index);
    const noteAt = before.lastIndexOf('NOTA');
    const note = noteAt >= 0 ? before.slice(noteAt) : before;
    const body = text.slice(heads[h].index, heads[h + 1]?.index ?? text.length);
    const caput = body.split(/ (?:Redação anterior|Redação original|NOTA|§ 1)/)[0];
    versions.push({ validFrom: effectiveDate(note), cests: cestsIn(caput) });
  }
  if (versions.length === 0 || versions[0].cests.length === 0) {
    throw new Error('RICMS/CE, art. 561: caput sem CEST');
  }
  // Data de cada CEST: a da versão mais antiga, em sequência a partir da atual, que já o trazia.
  const since = new Map();
  for (const cest of versions[0].cests) {
    let from = versions[0].validFrom;
    for (const v of versions.slice(1)) {
      if (!v.cests.includes(cest)) break;
      from = v.validFrom ?? from;
    }
    if (!from) throw new Error(`RICMS/CE, art. 561: sem data de efeitos para o CEST ${cest}`);
    since.set(cest, from);
  }

  // MVA-ST original (§§ 3º e 4º do art. 562): a primeira ocorrência de cada parágrafo é a atual.
  const art562 = text.indexOf('Art. 562.');
  const mvas = new Map();
  for (const m of text
    .slice(art562)
    .matchAll(
      /§ (\d)\.?º Para o caso de veículos elencados (.*?), a MVA-ST original é (\d{1,3}(?:,\d{1,2})?)%/g,
    )) {
    if (mvas.has(m[1])) continue;
    mvas.set(m[1], { scope: m[2], mva: m[3].replace(',', '.') });
  }
  if (mvas.size < 2) throw new Error('RICMS/CE, art. 562: MVA-ST original fora do formato');

  const caput = versions[0].cests;
  const mvaOf = new Map();
  for (const [paragraph, { scope, mva }] of mvas) {
    const listed = cestsIn(scope);
    const covered = /exceto/.test(scope)
      ? caput.filter((c) => !listed.includes(c))
      : listed.filter((c) => caput.includes(c));
    for (const cest of covered) {
      if (mvaOf.has(cest)) throw new Error(`RICMS/CE, art. 562: CEST ${cest} com duas MVAs`);
      mvaOf.set(cest, { mva, paragraph });
    }
  }
  const items = caput.map((cest) => {
    const found = mvaOf.get(cest);
    if (!found) throw new Error(`RICMS/CE, art. 562: CEST ${cest} sem MVA`);
    return { cest, mva: found.mva, paragraph: found.paragraph, validFrom: since.get(cest) };
  });
  return { currentFrom: versions[0].validFrom, items };
}

/** No formato de st-references.json. */
export function ceStReferences({ items }, { url, cests, segments }) {
  const byCest = new Map(cests.map((c) => [c.cest, c]));
  const unknown = items.filter((i) => !byCest.has(i.cest));
  if (unknown.length > 0) {
    throw new Error(
      `RICMS/CE: CEST fora do Convênio ICMS 142/18: ${unknown.map((i) => i.cest).join(', ')}`,
    );
  }
  const common = {
    uf: 'CE',
    act: 'RICMS/CE (Decreto 24.569/1997), Livro Terceiro, Seção XXVI (arts. 561 e 562)',
    source: 'stCeRicms97',
    url,
    validTo: null,
    note: 'MVA-ST original dos veículos novos (art. 562, §§ 3º e 4º). A base é o preço de venda da tabela do fabricante ou importador; a MVA só vale na falta dela. Na entrada de outra UF, usar as MVAs ajustadas do art. 562, § 1º. A retenção só se faz para o contribuinte que optou pela ST, exceto no ativo permanente (art. 561, § 1º); faturamento direto ao consumidor segue o Convênio ICMS 51/00. Vale a redação atual.',
  };
  // Uma referência por segmento do CEST, MVA e data de início.
  const groups = new Map();
  for (const i of items) {
    const segment = i.cest.slice(0, 2);
    const key = `${segment}|${i.mva}|${i.validFrom}`;
    if (!groups.has(key)) groups.set(key, { segment, validFrom: i.validFrom, rows: [] });
    const c = byCest.get(i.cest);
    groups.get(key).rows.push({
      item: c.item,
      cest: c.cest,
      ncms: c.ncm,
      ncmText: c.ncm.join(', '),
      description: c.description,
      mva: i.mva,
    });
  }
  const segmentNames = new Map(segments.map((s) => [s.code, s.name]));
  const nameOf = (code) => segmentNames.get(code) ?? `Segmento ${code} do CEST`;
  const references = [...groups.values()].map((g) => ({
    ...common,
    segment: g.segment,
    segmentName: nameOf(g.segment),
    validFrom: g.validFrom,
    items: g.rows,
  }));
  const annexes = [...new Set(items.map((i) => i.cest.slice(0, 2)))].map((segment) => ({
    annex: segment,
    name: nameOf(segment),
    cests: items.filter((i) => i.cest.startsWith(segment)).map((i) => ({ cest: i.cest })),
  }));
  return {
    segment: {
      uf: 'CE',
      act: 'RICMS/CE (Decreto 24.569/1997), Livro Terceiro, Seção XXVI (texto consolidado do SefazLegis)',
      source: 'stCeRicms97',
      url,
      annexes,
    },
    references,
  };
}
