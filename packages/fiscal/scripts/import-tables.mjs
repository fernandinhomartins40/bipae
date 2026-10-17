// Gera as tabelas fiscais (src/tables/data/*.json) a partir dos arquivos oficiais guardados em
// sources/. Nenhum dado fiscal é digitado à mão aqui: o que sai vem da planilha publicada.
//
// Uso:
//   pnpm --filter @bipae/fiscal tables          regrava os arquivos gerados
//   pnpm --filter @bipae/fiscal tables:check    falha se os arquivos gerados estiverem defasados
//
// Para atualizar uma tabela: baixe a planilha nova no portal indicado em sources/manifest.json,
// troque o arquivo, ajuste nome e datas no manifest e rode o comando. Os testes conferem o resto.
// Para saber se alguma fonte mudou: node scripts/check-sources.mjs (roda toda semana no GitHub).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import Decimal from 'decimal.js';
import { parseCest } from './cest.mjs';
import { parseNfceEndpoints } from './nfce-endpoints.mjs';
import { parseNfeEndpoints } from './nfe-endpoints.mjs';
import { markStale, parseDifal } from './difal.mjs';
import { parseSpAlimenticios } from './st-sp.mjs';
import { parseSpBebidasBase, parseSpCat68 } from './st-sp-cat68.mjs';
import { anexoIXLines, parsePrAnexoIX, parsePrRes571, prStReferences } from './st-pr.mjs';
import { pdfLines } from './pdf-text.mjs';
import { mgStReferences, parseMgNotes, parseMgParte2 } from './st-mg.mjs';
import { parseRsApendiceII, rsStReferences } from './st-rs.mjs';
import { parseScAnexo1A, scStReferences } from './st-sc.mjs';
import { readXlsx, unzip } from './xlsx.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(root, 'sources');
const dataDir = join(root, 'src/tables/data');
const manifest = JSON.parse(readFileSync(join(sourcesDir, 'manifest.json'), 'utf8'));

/** Número de série de data do Excel → AAAA-MM-DD ('' continua ''). */
const isoDate = (serial) => {
  if (serial === '') return null;
  const n = Number(serial);
  if (!Number.isInteger(n) || n < 20000 || n > 80000)
    throw new Error(`Data inesperada: "${serial}"`);
  return new Date((n - 25569) * 86_400_000).toISOString().slice(0, 10);
};

const clean = (text) => String(text).replace(/\s+/g, ' ').trim();

const flag = (value, where) => {
  if (value !== '0' && value !== '1')
    throw new Error(`Indicador fora de 0/1 em ${where}: "${value}"`);
  return value === '1';
};

/** Confere o cabeçalho: se a planilha mudar de formato, o importador para em vez de errar calado. */
function header(sheet, expected) {
  const found = sheet.rows[0].map(clean);
  for (const [index, name] of expected.entries()) {
    if (found[index] !== name) {
      throw new Error(
        `Planilha "${sheet.name}": coluna ${index + 1} deveria ser "${name}", veio "${found[index]}"`,
      );
    }
  }
  return new Map(found.map((name, index) => [name, index]));
}

function sheetOf(key, test) {
  const sheets = readXlsx(join(sourcesDir, manifest[key].file));
  const sheet = sheets.find((s) => test(s.name));
  if (!sheet) throw new Error(`Planilha esperada não encontrada em ${manifest[key].file}`);
  return sheet;
}

function importCfop() {
  const sheet = sheetOf('cfop', (name) => name === 'CFOP');
  header(sheet, [
    'CFOP',
    'Início de vigência',
    'Fim de vigência',
    'indNFe',
    'indComunica',
    'indTransp',
    'indDevol',
    'indRetor',
    'indAnula',
    'indRemes',
    'indComb',
    'indExcIBSCBS',
    'Título do CFOP',
  ]);
  return sheet.rows
    .slice(1)
    .filter((row) => row[0])
    .map((row) => {
      const code = row[0];
      if (!/^[1-35-7]\d{3}$/.test(code)) throw new Error(`CFOP inesperado: "${code}"`);
      if (!['0', '1', '2'].includes(row[10])) throw new Error(`indComb inesperado no CFOP ${code}`);
      const end = isoDate(row[2]);
      return {
        code,
        title: clean(row[12]),
        start: isoDate(row[1]),
        ...(end && { end }),
        nfe: flag(row[3], code),
        communication: flag(row[4], code),
        transport: flag(row[5], code),
        devolution: flag(row[6], code),
        return: flag(row[7], code),
        annulment: flag(row[8], code),
        shipment: flag(row[9], code),
        fuel: Number(row[10]),
        ibsCbsOnlyTaxpayer: flag(row[11], code),
      };
    });
}

function importClassTrib() {
  const cstSheet = sheetOf('classTrib', (name) => name.startsWith('CST '));
  header(cstSheet, [
    'CST-IBS/CBS',
    'Descrição CST-IBS/CBS',
    'ind_gIBSCBS',
    'ind_gIBSCBSMono',
    'ind_gRed',
    'ind_gDif',
    'ind_gTransfCred',
    'ind_ gCredPresIBSZFM',
    'ind_gAjusteCompet',
    'ind_RedutorBC',
  ]);
  const csts = cstSheet.rows
    .slice(1)
    .filter((row) => row[0])
    .map((row) => ({
      cst: row[0],
      description: clean(row[1]),
      groups: {
        ibsCbs: flag(row[2], row[0]),
        mono: flag(row[3], row[0]),
        reduction: flag(row[4], row[0]),
        deferral: flag(row[5], row[0]),
        creditTransfer: flag(row[6], row[0]),
        presumedCreditZfm: flag(row[7], row[0]),
        accrualAdjustment: flag(row[8], row[0]),
        baseReducer: flag(row[9], row[0]),
      },
    }));

  const sheet = sheetOf('classTrib', (name) => name.startsWith('cClass '));
  const col = header(sheet, [
    'CST-IBS/CBS',
    'Descrição CST-IBS/CBS',
    'cClassTrib',
    'Nome cClassTrib',
  ]);
  const need = (name) => {
    if (!col.has(name)) throw new Error(`Coluna "${name}" sumiu da planilha de cClassTrib`);
    return col.get(name);
  };
  const c = Object.fromEntries(
    [
      'Descrição cClassTrib',
      'LC 214/25',
      'Tipo de Alíquota',
      'pRedIBS',
      'pRedCBS',
      'ind_gTribRegular',
      'ind_gCredPresOper',
      'ind_gMonoPadrao',
      'ind_gMonoReten',
      'ind_gMonoRet',
      'ind_gpBioDiferenca',
      'ind_gEstornoCred',
      'tpRBSN',
      'tpDoacao',
      'dIniVig',
      'dFimVig',
      'DataAtualização',
      'indNFe',
      'indNFCe',
      'indNFSe',
      'ANEXO',
      'Link',
    ].map((name) => [name, need(name)]),
  );
  const percent = (value, code) => {
    const d = new Decimal(value);
    if (d.isNegative() || d.greaterThan(100))
      throw new Error(`Redução fora de 0 a 100 no cClassTrib ${code}`);
    return d.toString();
  };
  const known = new Set(csts.map((item) => item.cst));
  const classes = sheet.rows
    .slice(1)
    .filter((row) => row[2])
    .map((row) => {
      const code = row[2];
      if (!/^\d{6}$/.test(code)) throw new Error(`cClassTrib inesperado: "${code}"`);
      if (!known.has(row[0]))
        throw new Error(`cClassTrib ${code} aponta para CST desconhecido: ${row[0]}`);
      const end = isoDate(row[c.dFimVig]);
      const annex = clean(row[c.ANEXO]);
      const law = clean(row[c['LC 214/25']]);
      return {
        cClassTrib: code,
        cst: row[0],
        name: clean(row[3]),
        description: clean(row[c['Descrição cClassTrib']]),
        rateType: clean(row[c['Tipo de Alíquota']]),
        pRedIBS: percent(row[c.pRedIBS], code),
        pRedCBS: percent(row[c.pRedCBS], code),
        groups: {
          regularTaxation: flag(row[c.ind_gTribRegular], code),
          presumedCredit: flag(row[c.ind_gCredPresOper], code),
          monoStandard: flag(row[c.ind_gMonoPadrao], code),
          monoWithholding: flag(row[c.ind_gMonoReten], code),
          monoWithheld: flag(row[c.ind_gMonoRet], code),
          biofuelDifference: flag(row[c.ind_gpBioDiferenca], code),
          creditReversal: flag(row[c.ind_gEstornoCred], code),
        },
        tpRBSN: row[c.tpRBSN],
        tpDoacao: row[c.tpDoacao],
        start: isoDate(row[c.dIniVig]),
        ...(end && { end }),
        updatedAt: isoDate(row[c['DataAtualização']]),
        documents: {
          nfe: flag(row[c.indNFe], code),
          nfce: flag(row[c.indNFCe], code),
          nfse: flag(row[c.indNFSe], code),
        },
        ...(annex && { annex }),
        ...(law && { law }),
        lawUrl: clean(row[c.Link]),
      };
    });

  const labels = (name) => {
    const s = sheetOf('classTrib', (n) => n === name);
    return Object.fromEntries(
      s.rows
        .slice(1)
        .filter((row) => row[1] !== '')
        .map((row) => [row[1], clean(row[2])]),
    );
  };
  return { csts, classes, tpRBSN: labels('tpRBSN'), tpDoacao: labels('tpDoacao') };
}

function importCbsRates() {
  const sheet = sheetOf('cbsRates', () => true);
  if (clean(sheet.rows[1]?.[0]) !== 'Ano' || clean(sheet.rows[1]?.[1]) !== 'Alíquota') {
    throw new Error('Planilha de alíquotas da CBS mudou de formato');
  }
  return sheet.rows
    .slice(2)
    .filter((row) => row[0])
    .map((row) => {
      const year = Number(row[0]);
      if (!Number.isInteger(year) || year < 2026 || year > 2100)
        throw new Error(`Ano inesperado: ${row[0]}`);
      // A planilha guarda a fração (0,009); a tabela guarda o percentual, como na lei ("0.9").
      if (/^[\d.]+(E-?\d+)?$/i.test(row[1])) {
        return { year, rate: new Decimal(row[1]).times(100).toDecimalPlaces(8).toString() };
      }
      // Ano sem alíquota publicada: fica registrado como tal, nunca com número suposto.
      return { year, rate: null, note: clean(row[1]) };
    });
}

function importFcp() {
  const sheet = sheetOf('fcp', (name) => name === 'FCP');
  header(sheet, ['cUF', 'UF', 'Nome UF', 'Aliq_1', 'Aliq_2', 'Aliq_3']);
  return sheet.rows
    .slice(1)
    .filter((row) => /^\d{2}$/.test(row[0]))
    .map((row) => {
      const cells = [row[3], row[4], row[5]].map(clean).filter(Boolean);
      const parsed = cells.map((cell) => {
        const match = /^(Fixo|Max):\s*(\d+\.\d{2})$/.exec(cell);
        if (!match) throw new Error(`Alíquota de FCP em formato inesperado (${row[1]}): "${cell}"`);
        return { kind: match[1] === 'Fixo' ? 'fixed' : 'max', rate: match[2] };
      });
      const kinds = new Set(parsed.map((p) => p.kind));
      if (parsed.length === 0 || kinds.size !== 1)
        throw new Error(`FCP de ${row[1]} mistura tipos de alíquota`);
      return {
        cUF: row[0],
        uf: row[1],
        // "fixed": só estas alíquotas são aceitas; "max": qualquer valor até o teto.
        kind: parsed[0].kind,
        rates: parsed.map((p) => p.rate),
        note: clean(row[7]),
      };
    });
}

/** DD/MM/AAAA → AAAA-MM-DD. */
const brDate = (text) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!match) throw new Error(`Data inesperada: "${text}"`);
  return `${match[3]}-${match[2]}-${match[1]}`;
};

const nextDay = (iso) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

function importNcm() {
  const raw = JSON.parse(
    gunzipSync(readFileSync(join(sourcesDir, manifest.ncm.file))).toString('utf8'),
  );
  const items = raw.Nomenclaturas.map((item) => {
    // Capítulo (99), posição (99.99), subposição (9999.9 e 9999.99), item (9999.99.9) e NCM (9999.99.99).
    if (!/^(\d{2}|\d{2}\.\d{2}|\d{4}\.\d{1,2}|\d{4}\.\d{2}\.\d{1,2})$/.test(item.Codigo)) {
      throw new Error(`Código NCM em formato inesperado: "${item.Codigo}"`);
    }
    const code = item.Codigo.replaceAll('.', '');
    // A descrição vem com marcação de itálico e com traços que só indicam o nível na árvore.
    const description = clean(item.Descricao.replace(/<[^>]*>/g, '')).replace(/^(-\s*)+/, '');
    if (!description) throw new Error(`NCM ${code} sem descrição`);
    const row = [code, description, brDate(item.Data_Inicio)];
    // No Siscomex o fim é o último dia válido; a tabela guarda o primeiro dia em que não vale mais.
    if (item.Data_Fim !== '31/12/9999') row.push(nextDay(brDate(item.Data_Fim)));
    return row;
  });
  items.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { updatedAt: clean(raw.Data_Ultima_Atualizacao_NCM), act: clean(raw.Ato), items };
}

// Em que grupo do XML cada código de situação tributária entra (ex.: CST 40, 41 e 50 vão no
// grupo ICMS40). Sai do schema oficial, que é o que a SEFAZ usa para validar a nota.
const SCHEMA_GROUPS = [
  ['csosn', /^ICMSSN\d{3}$/],
  ['icms', /^ICMS(\d{2}|Part|ST)$/],
  ['pis', /^PIS(Aliq|Qtde|NT|Outr)$/],
  ['cofins', /^COFINS(Aliq|Qtde|NT|Outr)$/],
  ['ipi', /^IPI(Trib|NT)$/],
];

function importNfeSchema() {
  const files = unzip(readFileSync(join(sourcesDir, manifest.nfeSchema.file)));
  const layoutEntry = [...files].find(([name]) => /leiauteNFe_v[\d.]+\.xsd$/.test(name));
  if (!layoutEntry) throw new Error('Pacote de schemas sem o leiaute da NF-e');
  const layout = layoutEntry[1].toString('utf8');

  const found = {
    icms: new Map(),
    csosn: new Map(),
    pis: new Map(),
    cofins: new Map(),
    ipi: new Map(),
  };
  const names = [...layout.matchAll(/<xs:element name="([A-Za-z0-9]+)"/g)];
  for (const match of layout.matchAll(/<xs:element name="(CST|CSOSN)">([\s\S]*?)<\/xs:element>/g)) {
    // O grupo é o último elemento de tributo aberto antes deste campo.
    let owner = null;
    for (let i = names.length - 1; i >= 0 && !owner; i--) {
      if (names[i].index >= match.index) continue;
      const kind = SCHEMA_GROUPS.find(([, pattern]) => pattern.test(names[i][1]));
      if (kind) owner = { kind: kind[0], group: names[i][1] };
    }
    if (!owner) throw new Error('Campo CST/CSOSN fora de um grupo de tributo conhecido');
    if ((owner.kind === 'csosn') !== (match[1] === 'CSOSN')) {
      throw new Error(`Campo ${match[1]} inesperado no grupo ${owner.group}`);
    }
    const codes = [...match[2].matchAll(/<xs:enumeration value="([^"]*)"/g)].map((m) => m[1]);
    if (codes.length === 0) throw new Error(`Grupo ${owner.group} sem lista de códigos`);
    for (const code of codes) {
      const groups = found[owner.kind].get(code) ?? [];
      if (!groups.includes(owner.group)) groups.push(owner.group);
      found[owner.kind].set(code, groups);
    }
  }

  const origin = /<xs:simpleType name="Torig">([\s\S]*?)<\/xs:simpleType>/.exec(layout);
  if (!origin) throw new Error('Tipo Torig (origem da mercadoria) não encontrado no schema');
  const list = (map) =>
    [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, groups]) => ({ code, groups }));
  const result = {
    package: manifest.nfeSchema.file.replace(/\.zip$/, ''),
    icms: list(found.icms),
    csosn: list(found.csosn),
    pis: list(found.pis),
    cofins: list(found.cofins),
    ipi: list(found.ipi),
    orig: [...origin[1].matchAll(/<xs:enumeration value="([^"]*)"/g)].map((m) => m[1]),
  };
  for (const [kind, value] of Object.entries(result)) {
    if (Array.isArray(value) && value.length === 0)
      throw new Error(`Schema sem códigos de ${kind}`);
  }
  return result;
}

function importCest() {
  const html = gunzipSync(readFileSync(join(sourcesDir, manifest.cest.file))).toString('utf8');
  return parseCest(html, manifest.cest.downloadedAt);
}

function importPaymentMeans() {
  const sheet = sheetOf('paymentMeans', () => true);
  const head = sheet.rows[1]?.map(clean) ?? [];
  if (head[0] !== 'tPag' || head[1] !== 'Descrição' || head[2] !== 'dIniVig') {
    throw new Error('Tabela de meios de pagamento mudou de formato');
  }
  return sheet.rows
    .slice(2)
    .filter((row) => /^\d{2}$/.test(row[0]))
    .map((row) => {
      const end = isoDate(row[3]);
      return {
        code: row[0],
        description: clean(row[1]),
        start: isoDate(row[2]),
        ...(end && { end }),
      };
    });
}

function importNfceEndpoints() {
  const page = (key) =>
    gunzipSync(readFileSync(join(sourcesDir, manifest[key].file))).toString('utf8');
  return parseNfceEndpoints({
    svrsHtml: page('nfceAuthorizers'),
    encatWsHtml: page('nfceWebservicesEncat'),
    qrHtml: page('nfceQrCode'),
    chaveHtml: page('nfceUrlChave'),
  });
}

function importNfeEndpoints() {
  const page = (key) =>
    gunzipSync(readFileSync(join(sourcesDir, manifest[key].file))).toString('utf8');
  return parseNfeEndpoints({
    producaoHtml: page('nfeWebservicesProducao'),
    homologacaoHtml: page('nfeWebservicesHomologacao'),
  });
}

// Cadeia da ICP-Brasil: as SEFAZ usam certificados dela, que não vêm na lista padrão do Node.
function importIcpBrasil() {
  const zip = readFileSync(join(sourcesDir, manifest.icpBrasil.file));
  return [...unzip(zip)]
    .filter(([name]) => name.endsWith('.crt'))
    .map(([name, body]) => {
      const pem = body.toString('utf8').replace(/\r\n/g, '\n').trim();
      if (!/^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----$/.test(pem)) {
        throw new Error(`Certificado fora do formato PEM: ${name}`);
      }
      return {
        name: name
          .split('/')
          .pop()
          .replace(/\.crt$/, ''),
        pem,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Alíquotas internas por mercadoria do Portal Nacional da DIFAL, conferidas contra a alíquota
// geral confirmada na lei de cada UF (icms-uf.json, mantido à mão com a fonte de cada UF).
function importIcmsProducts(fcp) {
  const html = gunzipSync(readFileSync(join(sourcesDir, manifest.difal.file))).toString('utf8');
  const ufByCode = Object.fromEntries(fcp.map((f) => [f.cUF, f.uf]));
  const confirmed = JSON.parse(readFileSync(join(dataDir, 'icms-uf.json'), 'utf8')).general;
  return markStale(parseDifal(html, ufByCode), confirmed);
}

// Municípios do IBGE (F3-14.a): código de 7 dígitos (cMun da NF-e), nome e UF.
function importMunicipios() {
  const raw = JSON.parse(
    gunzipSync(readFileSync(join(sourcesDir, manifest.municipios.file))).toString('utf8'),
  );
  const items = raw.map((m) => {
    const code = String(m['municipio-id']);
    if (!/^\d{7}$/.test(code)) throw new Error(`Código de município inesperado: ${code}`);
    return [code, clean(m['municipio-nome']), m['UF-sigla']];
  });
  items.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return { items };
}

const tables = {
  'cfop.json': importCfop(),
  'class-trib.json': importClassTrib(),
  'cbs-rates.json': importCbsRates(),
  'fcp.json': importFcp(),
  'ncm.json': importNcm(),
  'nfe-codes.json': importNfeSchema(),
  'cest.json': importCest(),
  'payment-means.json': importPaymentMeans(),
  'nfce-endpoints.json': importNfceEndpoints(),
  'nfe-endpoints.json': importNfeEndpoints(),
  'icp-brasil.json': importIcpBrasil(),
  'municipios.json': importMunicipios(),
};

// Bebidas em SP (F3-26.e): a base da ST é a pauta da Portaria SRE 27/2026, no período que ela diz.
function withSpDrinksBase(annexes) {
  const html = gunzipSync(readFileSync(join(sourcesDir, manifest.stSpBebidas.file))).toString(
    'utf8',
  );
  const { from, to } = parseSpBebidasBase(html);
  return annexes.map((a) =>
    a.annex === 'III'
      ? {
          ...a,
          base: {
            kind: 'pauta',
            act: 'Portaria SRE 27/2026 (alterada pelas Portarias SRE 42/2026 e 45/2026)',
            url: manifest.stSpBebidas.page,
            validFrom: from,
            validTo: to,
            note: 'A base da ST é o valor em reais da pauta, por marca e embalagem (Capítulo I dos anexos). O IVA-ST do Capítulo II só vale quando o produto não tem valor na pauta (artigo 2º).',
          },
        }
      : a,
  );
}

// Substituição tributária por UF (F3-26): a MVA (IVA-ST) publicada por cada SEFAZ, por CEST e
// NCM. É referência para a regra de ICMS da empresa, não regra do motor: a empresa confirma.
// Paraná (F3-26.c): MVA da Resolução SEFA 571/2019 e o que saiu da ST pelo Anexo IX do RICMS/PR.
async function importStPr(known) {
  const pdf = async (key) => pdfLines(readFileSync(join(sourcesDir, manifest[key].file)));
  const res = parsePrRes571(await pdf('stPrRes571'), known);
  return prStReferences(res.tables, parsePrAnexoIX(anexoIXLines(await pdf('stPrAnexoIX'))), {
    resUrl: manifest.stPrRes571.page,
    anexoUrl: manifest.stPrAnexoIX.page,
  });
}

// Minas Gerais (F3-26.c.MG): Parte 2 do Anexo XV do RICMS/MG e as notas com a data de cada item.
function importStMg(known) {
  const html = (key) =>
    gunzipSync(readFileSync(join(sourcesDir, manifest[key].file))).toString('latin1');
  const notes = parseMgNotes([2, 3, 4].map((n) => html(`stMgNotas${n}`)));
  const { chapters } = parseMgParte2(
    [6, 7, 8, 9, 10, 11].map((n) => html(`stMgAnexoXV${n}`)),
    notes,
    known,
  );
  return mgStReferences(chapters, { url: manifest.stMgAnexoXV6.page });
}

// Rio Grande do Sul (F3-26.c.RS): Apêndice II do RICMS/RS, Seções II e III.
function importStRs(cest, known) {
  const html = gunzipSync(readFileSync(join(sourcesDir, manifest.stRsRicms.file))).toString(
    'latin1',
  );
  const names = new Map(cest.segments.map((s) => [s.code, s.name]));
  return rsStReferences(parseRsApendiceII(html, known), {
    url: manifest.stRsRicms.page,
    segmentName: (code) => names.get(code.slice(0, 2)) ?? `Segmento ${code.slice(0, 2)} do CEST`,
  });
}

async function importStReferences(cest) {
  const known = new Set(cest.items.map((c) => c.cest));
  const pr = await importStPr(known);
  const mg = importStMg(known);
  const rs = importStRs(cest, known);
  // Santa Catarina (F3-26.c.SC): Anexo 1-A do RICMS/SC, atual e com as seções revogadas.
  const sc = scStReferences(
    parseScAnexo1A(
      gunzipSync(readFileSync(join(sourcesDir, manifest.stScAnexo1A.file))).toString('latin1'),
      known,
    ),
    { url: manifest.stScAnexo1A.page },
  );
  const sp = gunzipSync(readFileSync(join(sourcesDir, manifest.stSpAlimenticios.file))).toString(
    'utf8',
  );
  const cat68 = gunzipSync(readFileSync(join(sourcesDir, manifest.stSpCat68.file))).toString(
    'utf8',
  );
  return {
    // Que mercadorias estão (ou saíram) da ST em cada UF, por anexo e por CEST.
    segments: [
      {
        uf: 'SP',
        act: 'Portaria CAT 68/2019 (texto consolidado)',
        source: 'stSpCat68',
        url: manifest.stSpCat68.page,
        annexes: withSpDrinksBase(parseSpCat68(cat68, known)),
      },
      pr.segment,
      mg.segment,
      rs.segment,
      sc.segment,
    ],
    references: [
      {
        uf: 'SP',
        segment: '17',
        segmentName: 'Produtos alimentícios',
        act: 'Portaria SRE 12/2026 (Anexo XVI da Portaria CAT 68/2019)',
        source: 'stSpAlimenticios',
        url: manifest.stSpAlimenticios.page,
        validFrom: '2026-05-01',
        validTo: '2029-01-31',
        note: 'Base: preço praticado + frete, seguro, impostos e encargos, mais o IVA-ST. Vindo de outra UF com alíquota interna maior que a interestadual, usar o IVA-ST ajustado (art. 1º, parágrafo único).',
        items: parseSpAlimenticios(sp, known),
      },
      ...pr.references,
      ...mg.references,
      ...rs.references,
      ...sc.references,
    ],
  };
}

// Depende do FCP (para o código de cada UF).
tables['icms-products.json'] = importIcmsProducts(tables['fcp.json']);
tables['st-references.json'] = await importStReferences(tables['cest.json']);

// De onde veio cada tabela, com o hash do arquivo: o teste confere que ninguém trocou a planilha
// sem regerar os dados.
tables['sources.json'] = Object.fromEntries(
  Object.entries(manifest).map(([key, source]) => [
    key,
    {
      ...source,
      sha256: createHash('sha256')
        .update(readFileSync(join(sourcesDir, source.file)))
        .digest('hex'),
    },
  ]),
);

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, data] of Object.entries(tables)) {
  const path = join(dataDir, name);
  // O NCM tem 15 mil linhas: uma por linha do arquivo, para o diff do git continuar legível.
  const next =
    name === 'ncm.json'
      ? `{"updatedAt":${JSON.stringify(data.updatedAt)},"act":${JSON.stringify(data.act)},"items":[\n${data.items.map((row) => JSON.stringify(row)).join(',\n')}\n]}\n`
      : name === 'municipios.json'
        ? `{"items":[\n${data.items.map((row) => JSON.stringify(row)).join(',\n')}\n]}\n`
        : name === 'cest.json'
          ? `{"segments":${JSON.stringify(data.segments)},"items":[\n${data.items.map((row) => JSON.stringify(row)).join(',\n')}\n]}\n`
          : `${JSON.stringify(data, null, 1)}\n`;
  if (check) {
    let current = '';
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* arquivo ainda não gerado */
    }
    if (current !== next) {
      stale++;
      console.error(`defasado: src/tables/data/${name}`);
    }
  } else {
    writeFileSync(path, next);
    const rows = Array.isArray(data) ? data : data.items;
    const size = rows ? `${rows.length} linhas` : `${Object.keys(data).length} chaves`;
    console.log(`gerado: src/tables/data/${name} (${size})`);
  }
}
if (stale > 0) {
  console.error('Rode: pnpm --filter @bipae/fiscal tables');
  process.exit(1);
}
if (check) console.log('Tabelas fiscais em dia com as planilhas oficiais.');
