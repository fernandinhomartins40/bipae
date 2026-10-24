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

/**
 * Expressão que a nota da saída interna seguinte leva (art. 7º, § 1º, ou o equivalente de cada
 * decreto): "ICMS retido por substituição tributária", seguida do número do decreto. Todos os seis
 * decretos trazem a regra; sem ela no texto, o monitor avisa.
 */
function outputNoteOf(text, decree, label) {
  const m =
    /[“"](ICMS retido por substituição tributária)[”"],? seguida do número deste Decreto/i.exec(
      text,
    );
  if (!m) throw new Error(`${label}: expressão da nota de saída não encontrada`);
  return `${m[1]} - Decreto nº ${decree.number}/${decree.year}`;
}

/**
 * Comprador optante pelo Simples Nacional: o vestuário exclui (34.256, art. 3º: "não se aplicam às
 * empresas optantes pelo Simples Nacional") e móveis troca a margem (32.900, art. 3º, § 8º). Os
 * outros decretos não têm regra própria: null.
 */
function simplesBuyerOf(text) {
  if (
    /disposições deste decreto não se aplicam às empresas optantes pelo Simples Nacional/i.test(
      text,
    )
  )
    return { rule: 'excluded', mva: null };
  const m =
    /margem de valor agregado de que trata o caput deste artigo será de (\d{1,3}(?:,\d{1,2})?)% \([^)]*\) para os estabelecimentos optantes pelo Simples Nacional/i.exec(
      text,
    );
  return m ? { rule: 'mva', mva: decimalText(m[1]) } : null;
}

/** A data de efeitos da última NOTA do texto antes da posição `at` (null quando não há). */
function noteDateBefore(text, at) {
  const before = text.slice(0, at);
  const start = Math.max(before.lastIndexOf('NOTA'), before.lastIndexOf('Nota'));
  // A nota precisa ser a do dispositivo: logo antes dele, sem outro texto longo no meio.
  if (start < 0 || at - start > 400) return null;
  return effectiveDate(before.slice(start));
}

/**
 * Transferência (F3-26.d.CE.d): o parágrafo da "base de cálculo para o recolhimento do imposto
 * pelo estabelecimento que receber em transferência". Três formas no texto:
 * - "será o valor do documento fiscal ..., acrescida da MVA nos seguintes percentuais: I - nas
 *   transferências internas, 60%; II - nas transferências interestaduais, 100%" (vestuário);
 * - "oriundas de outras unidades da Federação, será acrescida de MVA no percentual de 49,08%"
 *   (farmacêuticos);
 * - "será a definida no caput deste artigo, acrescida do percentual de 80%" (os outros), que soma
 *   à base do caput. Quando o caput já tem margem, não está claro se as duas se somam (D-042).
 */
function transferOf(text, label) {
  const listed =
    /receber,? em transferência,? mercadorias sujeitas à presente sistemática será o valor do documento fiscal.*?nos seguintes percentuais: I - nas transferências internas, (\d{1,3}(?:,\d{1,2})?)%.*?II - nas transferências interestaduais, (\d{1,3}(?:,\d{1,2})?)%/i.exec(
      text,
    );
  if (listed) {
    return {
      basis: 'document',
      interstateOnly: false,
      internalMva: decimalText(listed[1]),
      interstateMva: decimalText(listed[2]),
    };
  }
  const farma =
    /receber em transferência mercadorias sujeitas à presente sistemática, oriundas de outras unidades da Federação, será acrescida de MVA no percentual de (\d{1,3}(?:,\d{1,2})?)%/i.exec(
      text,
    );
  if (farma) {
    return {
      basis: 'document',
      interstateOnly: true,
      internalMva: null,
      interstateMva: decimalText(farma[1]),
    };
  }
  const caput =
    /receber,? em transferência,? mercadorias sujeitas? (?:a|à) (?:presente )?sistemática[^,.]*?(,? oriundas de outras? unidades? da Federação)?,? será a definida no caput deste artigo,? acrescida d[aoe] (?:percentual|margem de valor agregado(?: \(MVA\))? no percentual)(?: de)? (\d{1,3}(?:,\d{1,2})?)%/i.exec(
      text,
    );
  if (!caput) throw new Error(`${label}: parágrafo da transferência não encontrado`);
  const mva = decimalText(caput[2]);
  return {
    basis: 'caput',
    interstateOnly: !!caput[1],
    internalMva: caput[1] ? null : mva,
    interstateMva: mva,
  };
}

/**
 * Regime Especial de Tributação do atacadista do Anexo I (arts. 4º/5º): "poderá aplicar, como
 * carga líquida, aquela prevista no Anexo III" (autopeças, informática, construção e móveis; nos
 * dois últimos a carga "poderá ser ajustada, proporcionalmente", no termo). Null quando o decreto
 * não tem o artigo (vestuário).
 */
function specialRegimeOf(text) {
  const m =
    /Art\. ?(\d)\.?º O contribuinte que exercer a atividade (?:de comércio atacadista )?constante do Anexo I deste Decreto, mediante regime especial de tributação, nos termos previstos nos (?:arts\.|artigos) ?67 a 69 da Lei n\S* ?12\.670, de 27 de dezembro de 1996,(?: que dispõe sobre o ICMS,)? poderá aplicar, como carga líquida(?: tributária)?, aquela prevista no Anexo III deste Decreto(, que poderá ser ajustada, proporcionalmente)?/i.exec(
      text,
    );
  if (!m) return null;
  return { kind: 'annex-iii', article: `art. ${m[1]}º`, adjustable: !!m[2] };
}

const PERCENT_LINE = /^(\d{1,2}[.,]\d{2}) ?%$/;
const pct = (raw) => decimalText(raw.replace('.', ','));

/**
 * Farmacêuticos com RET (Decreto 36.617, arts. 4º a 12): cargas próprias na entrada (art. 6º, só
 * as colunas interestaduais), complemento do fornecedor do Simples, transferências, centro de
 * distribuição (art. 7º) e as tabelas da saída por canal (Hospitalar, art. 8º; Farma, art. 9º;
 * centro de distribuição, art. 10). A base é o valor do documento, sem margem.
 */
function farmaSpecialRegimeOf(lines, label) {
  const at = (re, from = 0) => {
    const i = lines.findIndex((l, n) => n >= from && re.test(l));
    if (i < 0) throw new Error(`${label}, RET: "${re.source}" não encontrado`);
    return i;
  };
  const art6 = at(/^Art\. 6\.º Para o cálculo do ICMS devido por substituição tributária/);
  const art7 = at(/^Art\. 7\.º Para o cálculo/, art6);
  const block = lines.slice(art6, art7);
  const head = fold(joinLines(block));
  // As colunas das tabelas do art. 6º: Norte...ES antes de Sul e Sudeste (e "Operações Internas"
  // antes das duas no complemento do Simples).
  const nne = head.indexOf('operacoes oriundas do norte');
  const sse = head.indexOf('operacoes oriundas do sul');
  if (nne < 0 || sse < nne) throw new Error(`${label}, RET: colunas do art. 6º fora da ordem`);
  const percents = block
    .filter((l) => PERCENT_LINE.test(l))
    .map((l) => pct(PERCENT_LINE.exec(l)[1]));
  const whole = block.filter((l) => /^\d{1,2}%$/.test(l)).map((l) => l.slice(0, -1));
  if (percents.length !== 4 || whole.length !== 3) {
    throw new Error(
      `${label}, RET: art. 6º com ${percents.length} cargas e ${whole.length} complementos`,
    );
  }
  const transferAt = block.findIndex((l) => /^OPERAÇÕES DE TRANSFERÊNCIAS/.test(l));
  if (transferAt < 0) throw new Error(`${label}, RET: transferências do art. 6º não encontradas`);
  const art7Text = joinLines(lines.slice(art7, at(/^§ 1\.º/, art7)));
  const cd =
    /I - (\d,\d{2})% \([^)]*\), quando das operações oriundas do Norte.*?II - (\d,\d{2})% \([^)]*\), quando das operações oriundas do Sul/.exec(
      art7Text,
    );
  if (!cd) throw new Error(`${label}, RET: cargas do art. 7º não encontradas`);
  const text = joinLines(lines);
  const deferred =
    /Nas operações internas entre contribuintes atacadistas sujeitos à sistemática de tributação deste Decreto, optantes pelo Regime Especial de Tributação, o ICMS devido fica diferido para a saída subsequente/.test(
      text,
    );
  const importDeferred =
    /as cargas tributárias previstas nos arts\. 6\.º e 7\.º não se aplicam aos produtos de origem estrangeira procedente de outras unidades da Federação, sujeitos à alíquota de 4%/.test(
      text,
    );
  return {
    kind: 'own-table',
    article: 'arts. 4º a 12',
    adjustable: true,
    entry: { 'n-ne-co-es': percents[0], 's-se-except-es': percents[1] },
    transfer: { 'n-ne-co-es': percents[2], 's-se-except-es': percents[3] },
    simplesAddition: { internal: whole[0], 'n-ne-co-es': whole[1], 's-se-except-es': whole[2] },
    distributionCenter: { 'n-ne-co-es': decimalText(cd[1]), 's-se-except-es': decimalText(cd[2]) },
    internalBetweenWholesalersDeferred: deferred,
    importedAt4Deferred: importDeferred,
    exits: [
      farmaExitTable(lines, at(/^Art\. 8\.º/), 'hospital', label),
      farmaExitTable(lines, at(/^Art\. 9\.º/), 'pharma', label),
      farmaExitTable(lines, at(/^Art\. 10\./), 'distribution-center', label),
    ],
  };
}

/** Uma tabela da saída do RET dos farmacêuticos (a redação atual, até a "Redação original"). */
function farmaExitTable(lines, start, channel, label) {
  const note = lines.findIndex((l, i) => i > start && /^Nota: a tabela com nova redação/.test(l));
  const end = lines.findIndex((l, i) => i > note && /^Redação original/.test(l));
  if (note < 0 || end < 0) throw new Error(`${label}, RET: tabela do canal ${channel} sem nota`);
  let noteText = '';
  let i = note;
  while (!/^MERCADORIA/.test(lines[i])) noteText += ` ${lines[i++]}`;
  const sections = { sale: { labels: [], values: [] } };
  let section = 'sale';
  let importAddition = null;
  let interstateImportAddition = null;
  for (; i < end; i++) {
    const line = lines[i];
    if (/^OPERAÇÕES DE TRANSFERÊNCIAS/.test(line)) {
      section = 'transfer';
      sections.transfer = { labels: [], values: [] };
      continue;
    }
    if (/^ADICIONAIS/.test(line)) section = 'import';
    if (/^(VENDA|SAÍDAS) INTERESTADUA/.test(line)) section = 'interstate';
    const foreign = /^Produto Estrangeiro \(4%\)(?: (\d{1,2},\d{2}) ?%)?$/.exec(line);
    if (foreign) {
      const value = foreign[1] ?? PERCENT_LINE.exec(lines[i + 1] ?? '')?.[1];
      if (!value) throw new Error(`${label}, RET: adicional do importado sem valor`);
      if (section === 'interstate') interstateImportAddition = pct(value);
      else importAddition = pct(value);
      if (!foreign[1]) i++;
      continue;
    }
    if (section !== 'sale' && section !== 'transfer') continue;
    if (/^(\d{1,2}% - Cesta Básica|20%)$/.test(line)) sections[section].labels.push(line);
    else if (PERCENT_LINE.test(line))
      sections[section].values.push(pct(PERCENT_LINE.exec(line)[1]));
  }
  const rows = (s) => {
    if (s.labels.length === 0 || s.labels.length !== s.values.length) {
      throw new Error(
        `${label}, RET: canal ${channel} com ${s.labels.length} linhas e ${s.values.length} valores`,
      );
    }
    return s.labels.map((l, n) => ({
      goodsClass: goodsClassOf(l),
      label: l,
      percent: s.values[n],
    }));
  };
  const validFrom = effectiveDate(noteText);
  if (!validFrom) throw new Error(`${label}, RET: tabela do canal ${channel} sem data de efeitos`);
  return {
    channel,
    validFrom,
    sale: rows(sections.sale),
    transfer: sections.transfer ? rows(sections.transfer) : null,
    importAddition,
    interstateImportAddition,
  };
}

/**
 * Retenção da indústria nas saídas internas (art. 2º de informática, construção e móveis). Só a
 * redação atual, com a data de efeitos da nota; antes dela a função responde "sem tabela".
 * - informática: carga fixa sobre o valor da operação mais a margem; outra carga (§ 4º) para o
 *   produto fora do ato do Secretário; sem margem "quando o contribuinte do imposto for o
 *   estabelecimento matriz" (§ 3º, ambíguo: vira aviso);
 * - construção: carga fixa e margem; "ajuste proporcional" quando a carga do produto não é a do
 *   art. 2º-B; carga própria, opcional, para duas CNAE de cerâmica (art. 2º-A); fora a indústria
 *   do Simples (§ 2º, II);
 * - móveis: "a carga líquida de que trata o Anexo III" (redação do Decreto 32.984, desde 2019). A
 *   linha é a do "ATACADISTA (Anexo I)", porque o Anexo I é "Indústria e Comércio Atacadista"
 *   (art. 1º), e a coluna é a do "Próprio Estado", porque a retenção é "nas operações internas"
 *   (F3-26.d.CE.e). A redação original do art. 2º dava a carga fixa de 6,93%, que é exatamente a
 *   célula atacadista / 18% / próprio Estado do Anexo III de 2019: o gerador confere. O § 5º manda o
 *   "ajuste proporcional" quando a carga do produto não é 20%, sem dizer a conta.
 */
function industryOf(text, label, versions) {
  const info =
    /estabelecimento industrial localizado neste Estado, fabricante de produtos de informática, deverá reter, nas operações internas, a carga líquida tributária de (\d{1,2},\d{2})% .*?margem de valor agregado no percentual de (\d{1,3})%/.exec(
      text,
    );
  if (info) {
    const unlisted =
      /Na hipótese de os produtos de informática não estarem relacionados em ato do Secretário da Fazenda, a carga tributária líquida de que trata o caput deste artigo será de (\d{1,2},\d{2})%/.exec(
        text,
      );
    if (!unlisted) throw new Error(`${label}: § 4º do art. 2º não encontrado`);
    const dates = [noteDateBefore(text, info.index), noteDateBefore(text, unlisted.index)];
    if (dates.some((d) => !d)) throw new Error(`${label}: art. 2º sem data de efeitos`);
    return {
      kind: 'fixed',
      article: 'art. 2º',
      validFrom: dates.sort().at(-1),
      load: decimalText(info[1]),
      unlistedLoad: decimalText(unlisted[1]),
      mva: info[2],
      referenceRate: null,
      optional: null,
      simplesExcluded: false,
      headOfficeWithoutMva:
        /margem de valor agregado de que trata o caput deste artigo não se aplica quando o contribuinte do imposto for o estabelecimento matriz/.test(
          text,
        ),
      annexRow: null,
      simplesRecipientExcluded: false,
    };
  }
  const build =
    /estabelecimento industrial constante no Anexo I, fabricante de material de construção, ferragens e ferramentas, deverá reter, nas operações internas, a carga líquida tributária de (\d{1,2},\d{2})% .*?margem de valor agregado no percentual de (\d{1,3})%/.exec(
      text,
    );
  if (build) {
    const validFrom = noteDateBefore(text, build.index);
    const reference =
      /Nas hipóteses dos arts\. 2\.?º e 2\.?º-A, quando a carga tributária do ICMS relativa ao produto for diferente de (\d{1,2})%/.exec(
        text,
      );
    const ceramics =
      /CNAEs?[- ]*Fiscais (\d{4}-\d\/\d{2}) \(.*?\) e (\d{4}-\d\/\d{2}) \(.*?\) poderá reter, nas operações internas, a carga tributária líquida de (\d{1,2},\d{2})%/.exec(
        text,
      );
    if (!validFrom || !reference || !ceramics) {
      throw new Error(`${label}: arts. 2º, 2º-A ou 2º-B fora do formato`);
    }
    return {
      kind: 'fixed',
      article: 'art. 2º',
      validFrom,
      load: decimalText(build[1]),
      unlistedLoad: null,
      mva: build[2],
      referenceRate: reference[1],
      optional: {
        article: 'art. 2º-A',
        cnaes: [cnaeCode(ceramics[1]), cnaeCode(ceramics[2])],
        load: decimalText(ceramics[3]),
      },
      simplesExcluded: /praticadas por indústria optante pelo Simples Nacional/.test(text),
      headOfficeWithoutMva: false,
      annexRow: null,
      simplesRecipientExcluded: false,
    };
  }
  const furniture =
    /estabelecimentos industriais constantes no Anexo I,.*?deverão reter, nas operações internas, a carga líquida de que trata o Anexo III deste Decreto aplicada sobre o valor da operação acrescido da margem de valor agregado no percentual de (\d{1,3})%/.exec(
      text,
    );
  if (furniture) {
    const reference =
      /§ ?5\.?º Caso se trate de operações de circulação de mercadorias cuja carga tributária do ICMS for diferente de (\d{1,2})%.*?será feito o ajuste proporcional na carga tributária líquida de que trata o caput deste artigo/.exec(
        text,
      );
    const original =
      /Redação original do caput do art\. 2\.º: Art\. 2\.º Sem prejuízo .*?deverá reter, nas operações internas, a carga líquida tributária de (\d{1,2},\d{2})%/.exec(
        text,
      );
    const dates = [
      noteDateBefore(text, furniture.index),
      reference && noteDateBefore(text, reference.index),
    ];
    if (!reference || !original || dates.some((d) => !d)) {
      throw new Error(`${label}: art. 2º ou § 5º fora do formato`);
    }
    // A carga fixa da redação original tem de ser a célula atacadista / próprio Estado da tabela
    // mais antiga lida (a que entrou junto com a redação "carga do Anexo III"): é a prova da linha
    // e da coluna. A primeira coluna é a do próprio Estado (`checkOriginColumns`).
    const oldest = versions.at(-1);
    const cell = oldest?.rows.find(
      (r) => r.group === 'wholesale' && r.values[0] === decimalText(original[1]),
    );
    if (!cell) {
      throw new Error(
        `${label}: a carga original do art. 2º (${original[1]}%) não está na linha do atacadista, próprio Estado, do Anexo III de ${oldest?.validFrom}`,
      );
    }
    return {
      kind: 'annex-iii',
      article: 'art. 2º',
      validFrom: dates.sort().at(-1),
      load: null,
      unlistedLoad: null,
      mva: furniture[1],
      referenceRate: reference[1],
      optional: null,
      simplesExcluded: false,
      headOfficeWithoutMva: false,
      annexRow: { group: 'wholesale', origin: 'internal', formerLoad: decimalText(original[1]) },
      simplesRecipientExcluded:
        /O disposto no caput deste artigo não se aplica às operações destinadas a: I [–-] comerciante atacadista signatário de Regime Especial de Tributação.*?II [–-] empresas optantes pelo Simples Nacional/.test(
          text,
        ),
    };
  }
  return null;
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
    outputNote: outputNoteOf(text, decree, where),
    simplesBuyer: simplesBuyerOf(text),
    cestSegments: null,
    transfer: transferOf(text, where),
    specialRegime: specialRegimeOf(text),
    industry: hasIndustry ? industryOf(text, where, versions) : null,
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
    outputNote: outputNoteOf(text, decree, where),
    simplesBuyer: simplesBuyerOf(text),
    cestSegments: [cest[1]],
    transfer: transferOf(text, where),
    specialRegime: farmaSpecialRegimeOf(lines, where),
    industry: null,
  };
}

const NCM_CODE = String.raw`\d{4}(?:\.\d{1,2}(?:\.\d{2})?)?`;
const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Data do cabeçalho do Diário Oficial ("FORTALEZA, 28 DE OUTUBRO DE 2025"). */
function doeDateOf(lines) {
  for (const line of lines) {
    const m = /FORTALEZA, (\d{1,2}) DE (\p{L}+) DE (\d{4})/u.exec(line);
    if (!m) continue;
    const month = MONTHS.indexOf(fold(m[2]));
    if (month < 0) continue;
    return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  throw new Error('Diário Oficial do Ceará: data do cabeçalho não encontrada');
}

/**
 * Linhas "NCM DISCRIMINAÇÃO" de um anexo de IN no Diário Oficial. O PDF às vezes põe a NCM sozinha
 * numa linha e a descrição na seguinte, ou cola a NCM no fim da descrição ("...dados8528.52.00"):
 * várias NCM com a mesma descrição viram um item só.
 */
function parseNcmTable(lines) {
  const items = [];
  let pending = [];
  let lastGroup = false;
  const only = new RegExp(`^(${NCM_CODE})$`);
  const leading = new RegExp(`^(${NCM_CODE}) (.+)$`);
  const glued = /^(.*?\D)(\d{4}\.\d{2}\.\d{2})$/;
  const skip = (line) => !line || /DIÁRIO OFICIAL DO ESTADO|^NCM DISCRIMINAÇÃO/.test(line);
  const clean = lines.map((l) => l.trim()).filter((l) => !skip(l));
  for (const [index, line] of clean.entries()) {
    if (line === '(...)') {
      lastGroup = false;
      continue;
    }
    const alone = only.exec(line);
    if (alone) {
      // NCM sozinha depois de um grupo: é do grupo, a não ser que a linha seguinte seja a descrição
      // de um item novo (sem NCM no começo).
      const next = clean[index + 1] ?? '';
      const startsNew = next !== '' && next !== '(...)' && !only.test(next) && !leading.test(next);
      if (lastGroup && pending.length === 0 && !startsNew) items.at(-1).ncm.push(alone[1]);
      else pending.push(alone[1]);
      continue;
    }
    const lead = leading.exec(line);
    if (lead && pending.length === 0) {
      items.push({ ncm: [lead[1]], description: lead[2] });
      lastGroup = false;
      continue;
    }
    const tail = glued.exec(line);
    const text = tail ? tail[1] : line;
    if (pending.length > 0) {
      items.push({ ncm: [...pending, ...(tail ? [tail[2]] : [])], description: text });
      pending = [];
      lastGroup = true;
      continue;
    }
    const last = items.at(-1);
    if (!last) throw new Error(`Lista de NCM: texto antes do primeiro item: "${line}"`);
    last.description = joinLines([last.description, text]);
    if (tail) last.ncm.push(tail[2]);
  }
  if (pending.length > 0) throw new Error(`Lista de NCM: NCM sem descrição: ${pending.join(', ')}`);
  return items.map((item) => {
    const description = item.description.replace(/\*/g, '').trim();
    const except = [...description.matchAll(/exceto NCM (\d{4}\.\d{2}\.\d{2})/g)].map((m) => m[1]);
    return { ncm: item.ncm, description, except };
  });
}

/**
 * Lista dos produtos de informática do "ato do Secretário da Fazenda" (Decreto 31.066/2012, art.
 * 1º, parágrafo único, "b"): Instrução Normativa SEFAZ 148/2024 (DOE de 15/01/2025, efeitos a
 * partir de 01/03/2025, revogou a IN 04/2013), alterada pela IN 135/2025 (DOE de 28/10/2025) e
 * pela IN 20/2026 (DOE de 12/02/2026), em vigor na publicação. Cada versão é a lista inteira na
 * data. `amendments`: `{ lines, number, year, source }` de cada IN que altera, em ordem.
 */
export function parseCeInformaticsList(in148Lines, ...amendments) {
  const start = in148Lines.findIndex((l) => /^INSTRUÇÃO NORMATIVA Nº ?148, de/.test(l));
  if (start < 0) throw new Error('IN 148/2024 não encontrada no Diário Oficial');
  const annex = in148Lines.findIndex(
    (l, i) => i > start && /^INSTRUÇÃO NORMATIVA Nº ?148\/2024$/.test(l),
  );
  const end = in148Lines.findIndex((l, i) => i > annex && /^SECRETARIA |^\*\*\* \*\*\*/.test(l));
  if (annex < 0 || end < 0) throw new Error('IN 148/2024: Anexo Único não encontrado');
  const body = joinLines(in148Lines.slice(start, annex));
  const effects = /produzindo efeitos a partir do dia (\d{1,2})\.?º de (\p{L}+) de (\d{4})/u.exec(
    body,
  );
  if (
    !effects ||
    !/Fica revogada a Instrução Normativa n\.º 04, de 31 de janeiro de 2013/.test(body)
  ) {
    throw new Error('IN 148/2024: vigência ou revogação da IN 04/2013 fora do formato');
  }
  const validFrom = `${effects[3]}-${String(MONTHS.indexOf(fold(effects[2])) + 1).padStart(2, '0')}-${effects[1].padStart(2, '0')}`;
  const base = parseNcmTable(in148Lines.slice(annex + 1, end));

  // Cada alteração (em ordem de publicação) gera a lista inteira a partir da anterior.
  const versions = [{ validFrom, validTo: null, amendedBy: null, items: base }];
  for (const { lines, number, year } of amendments) {
    const previous = versions[0];
    const items = amendList(previous.items, lines, number, year);
    const date = doeDateOf(lines);
    if (date <= previous.validFrom) throw new Error(`IN ${number}/${year}: data fora da ordem`);
    previous.validTo = dayBefore(date);
    versions.unshift({
      validFrom: date,
      validTo: null,
      amendedBy: `IN SEFAZ ${number}/${year}`,
      items,
    });
  }
  const names = amendments.map((a) => `${a.number}/${a.year}`);
  return {
    act: `Instrução Normativa SEFAZ 148/2024 (CE)${names.length ? `, alterada pelas INs ${names.join(' e ')}` : ''}`,
    decree: 'Decreto 31.066/2012 (CE)',
    sources: ['stCeInformaticaIn148', ...amendments.map((a) => a.source)],
    versions,
  };
}

/**
 * Uma instrução normativa que altera o Anexo Único da IN 148/2024 ("passa a vigorar com nova
 * redação ... e acréscimo das NCMs"): a tabela do art. 1º troca a descrição das NCM citadas e
 * acrescenta as que não estavam. Vigora na publicação (art. 2º).
 */
function amendList(base, lines, number, year) {
  const at = lines.findIndex((l) => new RegExp(`^INSTRUÇÃO NORMATIVA Nº ?${number}, de`).test(l));
  const art1 = lines.findIndex(
    (l, i) => i > at && /^Art\. 1\.º O Anexo Único da Instrução Normativa n\.º 148/.test(l),
  );
  const art2 = lines.findIndex(
    (l, i) =>
      i > art1 &&
      /^Art\. 2\.º Esta Instrução Normativa entra em vigor na data de sua publicação/.test(l),
  );
  if (at < 0 || art1 < 0 || art2 < 0) throw new Error(`IN ${number}/${year} fora do formato`);
  const table = lines.findIndex((l, i) => i > art1 && /^NCM DISCRIMINAÇÃO/.test(l));
  if (table < 0 || table > art2) throw new Error(`IN ${number}/${year}: tabela não encontrada`);
  const changes = parseNcmTable(lines.slice(table + 1, art2));
  const amended = base.map((item) => ({ ...item, ncm: [...item.ncm] }));
  for (const change of changes) {
    const same = amended.filter((item) => item.ncm.some((n) => change.ncm.includes(n)));
    if (same.length === 0) {
      amended.push(change);
      continue;
    }
    // A nova redação vale para as NCM citadas: cada uma ganha a descrição nova.
    for (const ncm of change.ncm) {
      const item = amended.find((i) => i.ncm.includes(ncm));
      if (!item) amended.push({ ...change, ncm: [ncm] });
      else if (item.ncm.length === 1)
        Object.assign(item, { description: change.description, except: change.except });
      else {
        item.ncm = item.ncm.filter((n) => n !== ncm);
        amended.push({ ...change, ncm: [ncm] });
      }
    }
  }
  return amended;
}

/**
 * Endereço de um caderno do Diário Oficial do Ceará pela data (AAAA-MM-DD) e o número do caderno.
 * É o mesmo endereço das INs 148/2024 e 135/2025 guardadas em sources/; não tem captcha.
 */
export const ceDoeUrl = (date, part) => {
  const day = date.replaceAll('-', '');
  return `https://imagens.seplag.ce.gov.br/PDF/${day}/do${day}p${String(part).padStart(2, '0')}.pdf`;
};

const IN148_CITED =
  /Instru[çc][ãa]o Normativa (?:SEFAZ )?n?\.? ?[º°]? ?148,? de 0?2 de dezembro de 2024|Instru[çc][ãa]o Normativa (?:SEFAZ )?n?\.? ?[º°]? ?148\/2024|\bIN (?:SEFAZ )?n?\.? ?[º°]? ?148\/2024/i;
const IN_HEADING =
  /^INSTRU[ÇC][ÃA]O NORMATIVA N[º°.]* ?(\d+)(?:,? de \d{1,2}\.?º? de \p{L}+ de (\d{4})|\/(\d{4}))?/iu;

/** As INs da lista de informática já lidas pelo Bipaê (número/ano). */
export const CE_INFORMATICS_ACTS = ['148/2024', '135/2025', '20/2026'];

/**
 * F3-26.d.CE.f: atos de um caderno do Diário Oficial que citam a IN SEFAZ 148/2024 (lista de
 * produtos de informática do Decreto 31.066/2012). Devolve o título da instrução normativa em que
 * a citação aparece e o trecho; `known` são as INs já lidas pelo Bipaê (número/ano), que não
 * contam. O Diário não tem busca por ato e a busca do SefazLegis pede captcha: por isso o monitor
 * lê os cadernos da semana.
 */
export function ceIn148Mentions(lines, known = CE_INFORMATICS_ACTS) {
  const found = [];
  let heading = null;
  for (let i = 0; i < lines.length; i++) {
    const head = IN_HEADING.exec(lines[i]);
    if (head) heading = { number: `${head[1]}/${head[2] ?? head[3] ?? '?'}`, line: lines[i] };
    // A citação pode quebrar a linha: confere a linha junto com a seguinte.
    const window = joinLines([lines[i], lines[i + 1] ?? '']);
    if (!IN148_CITED.test(window)) continue;
    // Citação inteira na linha seguinte: ela é contada na vez dela.
    if (!IN148_CITED.test(lines[i]) && IN148_CITED.test(lines[i + 1] ?? '')) continue;
    if (heading && known.includes(heading.number)) continue;
    found.push({ act: heading?.line ?? null, excerpt: window.slice(0, 240) });
  }
  return found;
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
    outputNote: parsed.outputNote,
    simplesBuyer: parsed.simplesBuyer,
    transfer: parsed.transfer,
    specialRegime: parsed.specialRegime,
    industry: parsed.industry,
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
