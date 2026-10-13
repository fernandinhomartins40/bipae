// Gera as tabelas fiscais (src/tables/data/*.json) a partir dos arquivos oficiais guardados em
// sources/. Nenhum dado fiscal é digitado à mão aqui: o que sai vem da planilha publicada.
//
// Uso:
//   pnpm --filter @bipae/fiscal tables          regrava os arquivos gerados
//   pnpm --filter @bipae/fiscal tables:check    falha se os arquivos gerados estiverem defasados
//
// Para atualizar uma tabela: baixe a planilha nova no portal indicado em sources/manifest.json,
// troque o arquivo, ajuste nome e datas no manifest e rode o comando. Os testes conferem o resto.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import { readXlsx } from './xlsx.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(root, 'sources');
const dataDir = join(root, 'src/tables/data');
const manifest = JSON.parse(readFileSync(join(sourcesDir, 'manifest.json'), 'utf8'));

/** Número de série de data do Excel → AAAA-MM-DD ('' continua ''). */
const isoDate = (serial) => {
  if (serial === '') return null;
  const n = Number(serial);
  if (!Number.isInteger(n) || n < 20000 || n > 80000) throw new Error(`Data inesperada: "${serial}"`);
  return new Date((n - 25569) * 86_400_000).toISOString().slice(0, 10);
};

const clean = (text) => String(text).replace(/\s+/g, ' ').trim();

const flag = (value, where) => {
  if (value !== '0' && value !== '1') throw new Error(`Indicador fora de 0/1 em ${where}: "${value}"`);
  return value === '1';
};

/** Confere o cabeçalho: se a planilha mudar de formato, o importador para em vez de errar calado. */
function header(sheet, expected) {
  const found = sheet.rows[0].map(clean);
  for (const [index, name] of expected.entries()) {
    if (found[index] !== name) {
      throw new Error(`Planilha "${sheet.name}": coluna ${index + 1} deveria ser "${name}", veio "${found[index]}"`);
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
  const col = header(sheet, ['CST-IBS/CBS', 'Descrição CST-IBS/CBS', 'cClassTrib', 'Nome cClassTrib']);
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
    if (d.isNegative() || d.greaterThan(100)) throw new Error(`Redução fora de 0 a 100 no cClassTrib ${code}`);
    return d.toString();
  };
  const known = new Set(csts.map((item) => item.cst));
  const classes = sheet.rows
    .slice(1)
    .filter((row) => row[2])
    .map((row) => {
      const code = row[2];
      if (!/^\d{6}$/.test(code)) throw new Error(`cClassTrib inesperado: "${code}"`);
      if (!known.has(row[0])) throw new Error(`cClassTrib ${code} aponta para CST desconhecido: ${row[0]}`);
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
      if (!Number.isInteger(year) || year < 2026 || year > 2100) throw new Error(`Ano inesperado: ${row[0]}`);
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
      if (parsed.length === 0 || kinds.size !== 1) throw new Error(`FCP de ${row[1]} mistura tipos de alíquota`);
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

const tables = {
  'cfop.json': importCfop(),
  'class-trib.json': importClassTrib(),
  'cbs-rates.json': importCbsRates(),
  'fcp.json': importFcp(),
};

// De onde veio cada tabela, com o hash do arquivo: o teste confere que ninguém trocou a planilha
// sem regerar os dados.
tables['sources.json'] = Object.fromEntries(
  Object.entries(manifest).map(([key, source]) => [
    key,
    {
      ...source,
      sha256: createHash('sha256').update(readFileSync(join(sourcesDir, source.file))).digest('hex'),
    },
  ]),
);

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, data] of Object.entries(tables)) {
  const path = join(dataDir, name);
  const next = `${JSON.stringify(data, null, 1)}\n`;
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
    const size = Array.isArray(data) ? `${data.length} linhas` : `${Object.keys(data).length} chaves`;
    console.log(`gerado: src/tables/data/${name} (${size})`);
  }
}
if (stale > 0) {
  console.error('Rode: pnpm --filter @bipae/fiscal tables');
  process.exit(1);
}
if (check) console.log('Tabelas fiscais em dia com as planilhas oficiais.');
