// Ceará (F3-26.d.CE.b): substituição tributária com "carga líquida" (Lei 14.237/2008).
//
// Em vários segmentos o Ceará não cobra a ST por MVA × alíquota menos o crédito: o estabelecimento
// cuja CNAE-Fiscal principal está nos anexos do decreto do segmento recolhe um percentual fixo
// ("carga líquida") sobre o valor da nota de entrada (com IPI, frete e encargos), acrescido de uma
// margem de valor agregado quando o decreto manda. O percentual depende de quem compra (atacadista,
// varejista), da carga interna da mercadoria (cesta básica a 7% ou 12%, 20%, 25%, 28%, álcool
// em gel, produtos de informática) e da origem (o próprio Ceará ou o exterior; Norte, Nordeste,
// Centro-Oeste e Espírito Santo; Sul e Sudeste, menos o Espírito Santo).
//
// Este leitor tira tudo do texto consolidado de cada decreto no SefazLegis: as CNAE dos Anexos I e
// II, as tabelas do Anexo III (a redação atual e as anteriores que estão no mesmo formato, cada uma
// com a data de efeitos da nota), a margem do artigo do cálculo e os acréscimos para o fornecedor do
// Simples Nacional e para o importado a 4% (Resolução do Senado 13/2012). Nada digitado à mão.
import { effectiveDate as noteDate } from './st-ce.mjs';

const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Junta linhas do PDF, desfazendo a hifenização do fim de linha ("Es- tado" → "Estado"). */
const joinLines = (lines) =>
  lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/(\p{Ll})- (\p{Ll})/gu, '$1$2')
    .trim();

/** "2,96%" → "2.96"; "21%" → "21". */
const decimalText = (raw) => raw.replace(',', '.');

/** Data de efeitos de uma nota do SefazLegis, inclusive no formato "a partir de 1º/04/2017". */
export function effectiveDate(note) {
  const numeric = /a partir d[eo] (?:dia )?(\d{1,2})\.?º?\/(\d{2})\/(\d{4})/i.exec(note);
  if (numeric) return `${numeric[3]}-${numeric[2]}-${numeric[1].padStart(2, '0')}`;
  return noteDate(note);
}

const dayBefore = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Número e ano do decreto, pela primeira linha ("DECRETO Nº 30.519, DE 26 DE ABRIL DE 2011"). */
function decreeOf(lines) {
  const m = /^DECRETO N\S*\s*([\d.]+),? DE .*?(\d{4})\.?$/i.exec(lines[0] ?? '');
  if (!m) throw new Error(`Decreto do Ceará: primeira linha fora do formato: "${lines[0]}"`);
  return { number: m[1], year: m[2] };
}

/** O segmento, pela ementa ("... NAS OPERAÇÕES COM PEÇAS, COMPONENTES E ACESSÓRIOS ..., NA FORMA"). */
function segmentNameOf(lines) {
  const ementa = joinLines(lines.slice(1, 14));
  const m = /OPERAÇÕES COM (.+?)(?:, NA FORMA| REALIZADAS POR)/.exec(ementa);
  if (!m) throw new Error('Decreto do Ceará: ementa sem o segmento');
  const name = m[1].toLowerCase();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const CNAE_LINE = /^(?:(?:\d{1,2}|[IVX]+)\s+)?(\d{4}-\d\/\d{2}|\d{7})(?:\s+(.*))?$/;
const cnaeCode = (raw) => raw.replace(/\D/g, '');

/** CNAE de um anexo (I ou II), com a data de inclusão quando uma nota a dá. */
function parseCnaeList(lines) {
  const items = [];
  let mode = 'skip';
  let note = '';
  let current = null;
  for (const line of lines) {
    if (/^NOTA\b/i.test(line)) {
      mode = 'note';
      note = line;
      continue;
    }
    if (/^Redação original/i.test(line) || /^Item \d/i.test(line)) {
      mode = 'skip';
      continue;
    }
    const m = CNAE_LINE.exec(line);
    if (m) {
      const included = mode === 'note' && /inclu[íi]d|acrescentad/i.test(note);
      current = {
        cnae: cnaeCode(m[1]),
        description: (m[2] ?? '').trim(),
        validFrom: included ? effectiveDate(note) : null,
      };
      items.push(current);
      mode = 'cnae';
      note = '';
      continue;
    }
    if (mode === 'note') {
      note += ` ${line}`;
      continue;
    }
    if (mode !== 'cnae' || /^\d{1,2}$/.test(line)) continue;
    // Continuação da descrição (a linha seguinte começa em minúscula, ou a CNAE veio sem texto).
    if (current.description === '' || /^\p{Ll}/u.test(line)) {
      current.description = `${current.description} ${line}`.trim();
    }
  }
  for (const item of items) {
    if (!/^\d{7}$/.test(item.cnae) || !item.description) {
      throw new Error(`CNAE fora do formato no anexo: ${JSON.stringify(item)}`);
    }
  }
  return items;
}

/** Classe da mercadoria pelo rótulo da linha do Anexo III. */
export function goodsClassOf(label) {
  const text = fold(label);
  const basket = /^(\d{1,2})% - cesta basica/.exec(text);
  if (basket) return `basket-${basket[1]}`;
  // Álcool sem finalidade combustível, gel antisséptico, até 1 L ("9,72%" nos decretos; o de
  // farmacêuticos escreve só a descrição). O "líquido e em gel NÃO antisséptico" é a linha de 25%.
  if (/^(9,72%\s*-?\s*)?alcool (com )?finalidade nao combustivel,? gel antisseptico/.test(text)) {
    return 'alcohol-gel-antiseptic';
  }
  if (/^produtos de informatica/.test(text)) return 'informatics';
  const rate = /^(\d{1,2})%/.exec(text);
  if (rate) return `rate-${rate[1]}`;
  throw new Error(`Linha do Anexo III sem classe de mercadoria: "${label}"`);
}

const VALUES_LINE =
  /^(.*?)\s*(\d{1,2}(?:,\d{1,2})?)%\s+(\d{1,2}(?:,\d{1,2})?)%\s+(\d{1,2}(?:,\d{1,2})?)%$/;
const LABEL_START = /^(\d{1,2}(?:,\d{2})?%|Produtos de\b)/i;
const GROUPS = [
  { re: /^ATACADIST/, group: 'wholesale', label: 'Atacadista (Anexo I)' },
  { re: /^VAREJISTA/, group: 'retail', label: 'Varejista (Anexo II)' },
  { re: /^INDÚSTRIA/, group: 'industry', label: 'Indústria (Anexo I)' },
];

/** Uma tabela do Anexo III no formato de linhas ("7% - Cesta básica 2,96% 5,50% 7,25%"). */
function parseRowTable(lines) {
  const header = [];
  const rows = [];
  let group = null;
  let pending = null;
  let industryNormal = false;
  for (const line of lines) {
    const marker = GROUPS.find((g) => g.re.test(line));
    if (marker) {
      if (pending) throw new Error(`rótulo sem valores: "${pending}"`);
      group = marker.group;
      continue;
    }
    if (group === null) {
      header.push(line);
      continue;
    }
    if (/^(A )?\(Anexo I{1,2}\)$/.test(line)) continue;
    if (/^Normal( Normal)+$/.test(line)) {
      if (group === 'industry') industryNormal = true;
      continue;
    }
    if (group === 'industry') throw new Error(`linha de indústria inesperada: "${line}"`);
    const values = VALUES_LINE.exec(line);
    if (values) {
      const label = joinLines([pending ?? '', values[1]].filter(Boolean));
      rows.push({
        group,
        goodsClass: goodsClassOf(label),
        label,
        values: [values[2], values[3], values[4]].map(decimalText),
      });
      pending = null;
      continue;
    }
    if (LABEL_START.test(line)) {
      if (pending) throw new Error(`rótulo sem valores: "${pending}"`);
      pending = line;
      continue;
    }
    if (pending) {
      pending = `${pending} ${line}`;
      continue;
    }
    // Continuação do rótulo da linha anterior (o PDF às vezes põe os valores no meio do texto).
    const last = rows.at(-1);
    if (last && last.group === group) last.label = joinLines([last.label, line]);
  }
  if (pending) throw new Error(`rótulo sem valores: "${pending}"`);
  return { header: joinLines(header), rows, industryNormal };
}

/** Confere as três colunas de origem no cabeçalho da tabela, na ordem. */
function checkOriginColumns(header, where) {
  const text = fold(header);
  const at = [
    text.search(/proprio estado (ou|e) exterior do pais/),
    text.search(/regioes norte,? nordeste,? (e )?centro[- ]*oeste e (o )?estado do espirito santo/),
    text.search(/regioes sul e sudeste,? exceto (o )?estado/),
  ];
  if (at.some((i) => i < 0) || !(at[0] < at[1] && at[1] < at[2])) {
    throw new Error(`${where}: cabeçalho do Anexo III fora do formato: "${header}"`);
  }
}

const NOTE_START = /^(NOTA|Nota)\b|^Redação (anterior|original)/;
const TABLE_START = /^(CONTRIBUINTE|“?ANEXO III|MERCADORIA)/;

/**
 * As redações do Anexo III, da atual para as anteriores. Para na primeira que não tem data de
 * efeitos ou não está no formato de linhas (as tabelas antigas por coluna ficam de fora).
 */
function parseAnnexIII(lines, where) {
  const blocks = [];
  let block = null;
  for (const line of lines) {
    if (NOTE_START.test(line)) {
      block = { note: line, table: null };
      blocks.push(block);
      continue;
    }
    if (!block) {
      block = { note: '', table: null };
      blocks.push(block);
    }
    if (block.table === null) {
      if (TABLE_START.test(line)) block.table = [line];
      else block.note += ` ${line}`;
    } else {
      block.table.push(line);
    }
  }
  const versions = [];
  // Só conta o bloco que tem tabela de verdade (o título "ANEXO III" solto antes da nota não conta).
  const isTable = (b) => b.table !== null && b.table.some((l) => GROUPS.some((g) => g.re.test(l)));
  for (const b of blocks.filter(isTable)) {
    const validFrom = effectiveDate(b.note);
    let table;
    try {
      table = parseRowTable(b.table);
      checkOriginColumns(table.header, where);
      const groups = new Set(table.rows.map((r) => r.group));
      if (!validFrom || !groups.has('wholesale') || !groups.has('retail')) {
        throw new Error('redação sem data de efeitos ou sem as linhas de atacadista e varejista');
      }
    } catch (error) {
      if (versions.length === 0) {
        throw new Error(`${where}, Anexo III atual: ${error.message}`, { cause: error });
      }
      if (process.env.BIPAE_DEBUG_CE)
        console.error(`${where}: redação antiga fora: ${error.message}`);
      break;
    }
    const newer = versions.at(-1);
    // Redação com a mesma data de efeitos de uma mais nova foi substituída desde o início.
    if (newer && validFrom >= newer.validFrom) continue;
    const amended = /Decreto n\S*\s*([\d.]+)/i.exec(b.note);
    versions.push({
      validFrom,
      validTo: newer ? dayBefore(newer.validFrom) : null,
      amendedBy: amended ? `Decreto ${amended[1]}` : null,
      header: table.header,
      industryNormal: table.industryNormal,
      rows: table.rows,
    });
  }
  return versions;
}

/** Percentual de um item de lista, com a origem pelo texto dele. */
function originOfText(text) {
  const t = fold(text);
  if (/operac(oes|ao) internas?/.test(t)) return 0;
  if (/sul e sudeste/.test(t)) return 2;
  if (/norte/.test(t)) return 1;
  throw new Error(`origem não reconhecida: "${text}"`);
}

/** Acréscimos por origem (fornecedor do Simples; importado a 4%), na ordem das colunas. */
function additionsAfter(text, start, label) {
  const at = text.search(start);
  if (at < 0) return null;
  const window = text.slice(at, at + 700);
  const found = [null, null, null];
  const re =
    /(?:\b[IVX]+ ?[-–]|\b[a-c]\)) ?(\d{1,2}(?:,\d{1,2})?)(?:%| \(\p{L}+\) pontos percentuais) ?(?:\([^)]*\))?,? ?([^;.]*)/gu;
  let count = 0;
  for (const m of window.matchAll(re)) {
    const column = originOfText(m[2]);
    if (found[column] !== null) break;
    found[column] = decimalText(m[1]);
    count++;
    if (count === 3) break;
  }
  if (count < 2) throw new Error(`${label}: acréscimos por origem fora do formato`);
  return found;
}

const SIMPLES_START =
  /oriundas de estabelecimentos (?:optantes pelo|enquadrados no) Simples Nacional/;
const IMPORT_START =
  /produtos de origem estrangeira procedentes de outras unidades da Federação, sujeit[oa]s à alíquota de 4%/;

/** Margem de valor agregado do artigo do cálculo (null quando o decreto não manda acrescentar). */
function mvaOf(text, label) {
  const m =
    /O imposto a ser retido e recolhido (?:pelos estabelecimentos [^,]+, )?na forma do art\. ?1\.?º,? será (.*?)§ ?1/i.exec(
      text,
    );
  if (!m) throw new Error(`${label}: artigo do cálculo não encontrado`);
  const mva =
    /margem de valor agregado (?:\(MVA\) )?(?:no percentual )?de (\d{1,3}(?:,\d{1,2})?)%/i.exec(
      m[1],
    ) ?? /\(MVA\) no percentual (?:de )?(\d{1,3}(?:,\d{1,2})?)%/i.exec(m[1]);
  return mva ? decimalText(mva[1]) : null;
}

/** Um decreto de carga líquida no modelo dos Anexos I, II e III (autopeças a vestuário). */
export function parseCeNetLoadDecree(lines) {
  const decree = decreeOf(lines);
  const where = `Decreto ${decree.number}`;
  const anexoI = lines.findIndex((l) => /^ANEXO I(?![IV])\b/.test(l));
  const anexoII = lines.findIndex((l, i) => i > anexoI && /^ANEXO II(?!I)\b/.test(l));
  if (anexoI < 0 || anexoII < 0) throw new Error(`${where}: Anexos I e II não encontrados`);
  const end = lines.findIndex(
    (l, i) =>
      i > anexoII &&
      /^(“?ANEXO III|NOTA: o Anexo III|Estado do Ceará|Redação original dos Anexos)/i.test(l),
  );
  if (end < 0) throw new Error(`${where}: fim do Anexo II não encontrado`);
  const wholesale = parseCnaeList(lines.slice(anexoI + 1, anexoII));
  const retail = parseCnaeList(lines.slice(anexoII + 1, end));
  const annexStart = lines.findIndex(
    (l, i) => i >= end && (/^(NOTA|Nota):.*Anexo III/i.test(l) || /^“?ANEXO III/.test(l)),
  );
  const versions = parseAnnexIII(lines.slice(annexStart), where);
  const text = joinLines(lines);
  // Anexo I "(Indústria e Comércio Atacadista)": a CNAE de fabricação é a da indústria, que não
  // recolhe a carga líquida na entrada (o cálculo do decreto é "pelos estabelecimentos atacadista e
  // varejista"; a tabela de informática diz "Normal"). Ver a dúvida D-042.
  const hasIndustry = /Anexo I \(Indústria e Comércio Atacadista\)/.test(text);
  const buyers = [
    ...wholesale.map((c) => ({
      ...c,
      group: hasIndustry && /^Fabricação/i.test(c.description) ? 'industry' : 'wholesale',
    })),
    ...retail.map((c) => ({ ...c, group: 'retail' })),
  ];
  return {
    decree,
    segmentName: segmentNameOf(lines),
    buyers,
    groups: GROUPS.filter((g) => buyers.some((b) => b.group === g.group)).map((g) => ({
      group: g.group,
      label: g.label,
    })),
    versions,
    mva: mvaOf(text, where),
    simplesAddition: additionsAfter(text, SIMPLES_START, `${where}, Simples Nacional`),
    importAddition: additionsAfter(text, IMPORT_START, `${where}, importado a 4%`),
    cestSegments: null,
  };
}

/**
 * Produtos farmacêuticos (Decreto 36.617/2025): as CNAE estão no art. 1º, os produtos são os do
 * segmento 13 do CEST e a tabela do § 2º do art. 2º vale para todos os compradores, com os valores
 * por coluna no PDF.
 */
export function parseCeFarmaDecree(lines) {
  const decree = decreeOf(lines);
  const where = `Decreto ${decree.number}`;
  const art1 = lines.findIndex((l) => /^Art\. 1\.?º/.test(l));
  const par1 = lines.findIndex((l, i) => i > art1 && /^§ 1\.?º/.test(l));
  const buyers = [];
  for (const line of lines.slice(art1, par1)) {
    const m = /^([IVX]+) - (\d{7}) - (.+)$/.exec(line);
    if (m) buyers.push({ cnae: m[2], description: m[3], validFrom: null, group: 'all' });
    else if (buyers.length > 0) buyers.at(-1).description += ` ${line}`;
  }
  for (const b of buyers) b.description = b.description.replace(/[;.]$/, '');
  if (buyers.length === 0) throw new Error(`${where}: CNAE do art. 1º não encontradas`);
  const text = joinLines(lines);
  const cest = /\(CEST\) (\d{2})\b/.exec(text);
  if (!cest) throw new Error(`${where}: segmento do CEST não encontrado`);

  const par2 = lines.findIndex((l) => /^§ 2\.?º O imposto a recolher será equivalente/.test(l));
  const noteAt = lines.findIndex((l, i) => i > par2 && /^Nota: a tabela com nova redação/.test(l));
  if (par2 < 0 || noteAt < 0) throw new Error(`${where}: tabela do § 2º do art. 2º não encontrada`);
  const stop = lines.findIndex((l, i) => i > noteAt && /^Redação original/.test(l));
  let i = noteAt;
  let note = '';
  while (!/^MERCADORIAS?\b/.test(lines[i])) note += ` ${lines[i++]}`;
  const header = [];
  while (!/^\d{1,2}% - Cesta/i.test(lines[i])) header.push(lines[i++]);
  const labels = [];
  while (!/^\d{1,2},\d{2}%$/.test(lines[i])) labels.push(lines[i++]);
  const values = [];
  while (/^\d{1,2},\d{2}%$/.test(lines[i])) values.push(decimalText(lines[i++].slice(0, -1)));
  while (i < stop) labels[labels.length - 1] += ` ${lines[i++]}`;
  if (values.length !== labels.length * 3) {
    throw new Error(`${where}: ${labels.length} linhas e ${values.length} valores na tabela`);
  }
  const headerText = joinLines(header);
  checkOriginColumns(headerText, where);
  const validFrom = effectiveDate(note);
  if (!validFrom) throw new Error(`${where}: tabela sem data de efeitos`);
  const amended = /Decreto n\S*\s*([\d.]+)/i.exec(note);
  // Os valores vêm coluna a coluna: primeiro os da origem interna de todas as linhas, e assim por diante.
  const rows = labels.map((raw, r) => {
    const label = joinLines([raw]);
    return {
      group: 'all',
      goodsClass: goodsClassOf(label),
      label,
      values: [0, 1, 2].map((c) => values[c * labels.length + r]),
    };
  });
  return {
    decree,
    segmentName: segmentNameOf(lines),
    buyers,
    groups: [{ group: 'all', label: 'Atacadista ou varejista (art. 1º)' }],
    versions: [
      {
        validFrom,
        validTo: null,
        amendedBy: amended ? `Decreto ${amended[1]}` : null,
        header: headerText,
        industryNormal: false,
        rows,
      },
    ],
    mva: mvaOf(text, where),
    simplesAddition: additionsAfter(text, SIMPLES_START, `${where}, Simples Nacional`),
    importAddition: additionsAfter(text, IMPORT_START, `${where}, importado a 4%`),
    cestSegments: [cest[1]],
  };
}

const ORIGIN_KEYS = ['internal', 'n-ne-co-es', 's-se-except-es'];

/** As chaves do manifest, uma por decreto (a primeira dá os nomes das colunas de origem). */
export const CE_NET_LOAD_SOURCES = [
  'stCeCargaAutopecas',
  'stCeCargaInformatica',
  'stCeCargaConstrucao',
  'stCeCargaMoveis',
  'stCeCargaVestuario',
  'stCeCargaFarmaceuticos',
];

/** Lê um decreto pela chave do manifest (farmacêuticos tem formato próprio). */
export const parseCeNetLoadSource = (source, lines) =>
  source === 'stCeCargaFarmaceuticos' ? parseCeFarmaDecree(lines) : parseCeNetLoadDecree(lines);

/**
 * As três origens das tabelas, com as UFs de cada uma pelas regiões do IBGE. Os nomes vêm do
 * cabeçalho do primeiro decreto ("Regiões Norte, Nordeste, Centro Oeste e Estado do Espírito Santo").
 */
export function originsOf(header, ufRegions, uf) {
  const text = header.replace(/\s+/g, ' ');
  const labels = [
    /Próprio Estado ou Exterior do País/,
    /Regiões Norte, Nordeste, Centro.?Oeste e (?:o )?Estado do Espírito Santo/,
    /Regiões Sul e Sudeste, exceto o Estado do Espírito Santo/,
  ].map((re) => {
    const m = re.exec(text);
    if (!m) throw new Error(`Cabeçalho das origens fora do formato: "${header}"`);
    return m[0];
  });
  const regionsIn = (label) =>
    [...label.matchAll(/Nordeste|Norte|Centro.?Oeste|Sudeste|Sul/g)].map((m) =>
      m[0].replace(/Centro.?Oeste/, 'Centro-Oeste'),
    );
  const stateIn = (label, re) => {
    const m = re.exec(label);
    if (!m) return null;
    const found = ufRegions.find((u) => u.name === m[1]);
    if (!found) throw new Error(`UF não encontrada no IBGE: ${m[1]}`);
    return found.uf;
  };
  return labels.map((label, i) => {
    if (i === 0) return { key: ORIGIN_KEYS[0], label, ufs: [uf], abroad: true };
    const regions = regionsIn(label);
    const plus = stateIn(label, / e (?:o )?Estado d[oe] (\p{L}[\p{L} ]+)$/u);
    const minus = stateIn(label, /exceto o Estado d[oe] (\p{L}[\p{L} ]+)$/u);
    const ufs = ufRegions
      // O próprio Estado é a primeira coluna, mesmo estando numa das regiões.
      .filter((u) => u.uf !== uf)
      .filter((u) => (regions.includes(u.region) && u.uf !== minus) || u.uf === plus)
      .map((u) => u.uf)
      .sort();
    return { key: ORIGIN_KEYS[i], label, ufs, abroad: false };
  });
}

const byColumn = (values) =>
  values
    ? Object.fromEntries(values.flatMap((v, i) => (v === null ? [] : [[ORIGIN_KEYS[i], v]])))
    : null;

/** No formato de st-net-loads.json. */
export function ceNetLoadRegimes(decrees, { ufRegions }) {
  const origins = originsOf(decrees[0].parsed.versions[0].header, ufRegions, 'CE');
  const regimes = decrees.map(({ parsed, source, url }) => ({
    uf: 'CE',
    id: source,
    act: `Decreto ${parsed.decree.number}/${parsed.decree.year} (CE)`,
    law: 'Lei 14.237/2008 (CE)',
    source,
    url,
    segmentName: parsed.segmentName,
    cnaeBasis: 'principal',
    cestSegments: parsed.cestSegments,
    mva: parsed.mva,
    groups: parsed.groups,
    buyers: parsed.buyers,
    simplesAddition: byColumn(parsed.simplesAddition),
    importAddition: byColumn(parsed.importAddition),
    versions: parsed.versions.map((v) => ({
      validFrom: v.validFrom,
      validTo: v.validTo,
      amendedBy: v.amendedBy,
      industryNormal: v.industryNormal,
      loads: v.rows.map((r) => ({
        group: r.group,
        goodsClass: r.goodsClass,
        label: r.label,
        percents: byColumn(r.values),
      })),
    })),
  }));
  return { origins, regimes };
}
