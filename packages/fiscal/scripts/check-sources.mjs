// Confere se as fontes fiscais oficiais mudaram desde o que está guardado em sources/ (F3-31).
//
// Uso:
//   node scripts/check-sources.mjs                 mostra o relatório (sai com 2 se algo mudou)
//   node scripts/check-sources.mjs --report r.md   também grava o relatório em Markdown
//   node scripts/check-sources.mjs --save-listings guarda os títulos atuais das listas do Portal
//
// Nada é atualizado sozinho: quem atualiza troca o arquivo oficial e regera as tabelas.
import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseCest } from './cest.mjs';
import { parseDifal } from './difal.mjs';
import { parseSpAlimenticios } from './st-sp.mjs';
import { parseSpCat68 } from './st-sp-cat68.mjs';
import { anexoIXLines, parsePrAnexoIX, parsePrRes571, prStReferences, prStRows } from './st-pr.mjs';
import { pdfItems, pdfLines } from './pdf-text.mjs';
import { parseCbenefPr, parseCbenefRj } from './cbenef-pr.mjs';
import { parseCbenefSc } from './cbenef-sc.mjs';
import { parseCbenefRs } from './cbenef-rs.mjs';
import { parseCbenefGo } from './cbenef-go.mjs';
import { parseCbenefDf, parseCbenefEs } from './cbenef-es.mjs';
import { parseDemonstration } from './demonstration.mjs';
import { parseCbenefSp } from './cbenef-sp.mjs';
import { parseCbenefPortal } from './cbenef-portal.mjs';
import { readXlsx } from './xlsx.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mgStReferences, parseMgNotes, parseMgParte2 } from './st-mg.mjs';
import { parseRsApendiceII } from './st-rs.mjs';
import { parseScAnexo1A } from './st-sc.mjs';
import { parseBaAnexo1 } from './st-ba.mjs';
import { parseGoApendiceII } from './st-go.mjs';
import { parsePeAnexo37 } from './st-pe.mjs';
import { parsePbSheet } from './st-pb.mjs';
import { parseMtPortaria195 } from './st-mt.mjs';
import { parseConfazSt } from './st-confaz.mjs';
import { parseRjAnexoI } from './st-rj.mjs';
import { parseMsSubanexoI } from './st-ms.mjs';
import { parseEsPortaria16R } from './st-es.mjs';
import { parseAlDecreto90309 } from './st-al.mjs';
import { parseRoAnexoVI } from './st-ro.mjs';
import { parseCeVeiculos } from './st-ce.mjs';
import { DF_ANEXO_IV_REQUEST, DF_LEGISLATION_API, parseDfAnexoIV } from './st-df.mjs';
import {
  CE_NET_LOAD_SOURCES,
  ceDoeUrl,
  ceIn148Mentions,
  parseCeNetLoadSource,
} from './st-ce-carga.mjs';
import { parseAcIn12023 } from './st-ac.mjs';
import { parseAmLei6108 } from './st-am.mjs';
import { parseRnAnexo007 } from './st-rn.mjs';
import {
  MA_ANNEX_REPOSITORY,
  MA_ANNEX_SOURCES,
  MA_PORTAL_API,
  maPortalLogin,
  parseMaAnnex,
} from './st-ma.mjs';
import { docText } from './doc-text.mjs';
import { parseNfceEndpoints } from './nfce-endpoints.mjs';
import { parseNfeEndpoints } from './nfe-endpoints.mjs';
import { parseSimplesAnnexes } from './simples-annexes.mjs';
import {
  diffRows,
  diffTitles,
  listingTitles,
  nfsePageEntries,
  reportMarkdown,
} from './sources-watch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(root, 'sources');
const dataDir = join(root, 'src/tables/data');
const manifest = JSON.parse(readFileSync(join(sourcesDir, 'manifest.json'), 'utf8'));
const listingsPath = join(sourcesDir, 'listings.json');

// Alguns portais da SEFAZ usam a cadeia da ICP-Brasil, que não vem na lista padrão do Node.
const icp = JSON.parse(readFileSync(join(dataDir, 'icp-brasil.json'), 'utf8')).map((c) => c.pem);
// Os certificados do sistema cobrem servidores que não mandam o intermediário (o Windows e o
// Ubuntu completam a cadeia). Mas misturados aos do Node eles às vezes levam a uma cadeia que não
// fecha: a primeira tentativa vai sem eles, e só um erro de cadeia tenta de novo com eles.
const system = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
const CA_LISTS = [
  [...new Set([...tls.rootCertificates, ...icp])],
  [...new Set([...tls.rootCertificates, ...system, ...icp])],
];
const CHAIN_ERRORS = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN',
]);

/** GET com redirecionamentos e cookies (o Portal da NF-e exige os dois). */
// A SEFAZ-RJ recusa pedidos sem os cabeçalhos de um navegador comum (mostra uma página de bloqueio).
const BROWSER = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9',
  'upgrade-insecure-requests': '1',
};

/**
 * A SEFAZ-RJ responde ao Node com uma página de bloqueio (mesmo com os cabeçalhos de um
 * navegador), mas entrega o arquivo ao curl. Para esse portal o download vai pelo curl.
 */
function downloadWithCurl(url) {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      [
        '-sSL',
        '--max-time',
        '120',
        '-A',
        BROWSER['user-agent'],
        // Sem este cabeçalho, exatamente assim, o portal devolve a página de bloqueio.
        '-H',
        'Accept-Language: pt-BR',
        '-w',
        '\n%{content_type}',
        url,
      ],
      { encoding: 'buffer', maxBuffer: 200 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error(`curl: ${error.message}`));
        const cut = stdout.lastIndexOf(0x0a);
        resolve({
          body: stdout.subarray(0, cut),
          type: stdout.subarray(cut + 1).toString('utf8'),
        });
      },
    );
  });
}

async function download(url, jar = new Map(), hops = 0) {
  if (/fazenda\.rj\.gov\.br/.test(url)) return downloadWithCurl(url);
  try {
    return await fetchOnce(url, jar, hops, CA_LISTS[0]);
  } catch (error) {
    if (!CHAIN_ERRORS.has(error.code)) throw error;
    return fetchOnce(url, jar, hops, CA_LISTS[1]);
  }
}

function fetchOnce(url, jar, hops, ca) {
  return new Promise((resolve, reject) => {
    if (hops > 10) return reject(new Error('redirecionamentos demais'));
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    // A SEFAZ-MT só publica a legislação por HTTP (o mesmo endereço não abre por HTTPS).
    const client = url.startsWith('http://') ? http : https;
    const req = client.get(
      url,
      {
        ...(client === https && { ca }),
        timeout: 60_000,
        headers: {
          ...(/fazenda\.rj\.gov\.br/.test(url)
            ? BROWSER
            : { 'user-agent': 'Mozilla/5.0 (Bipae fontes)' }),
          // O SefazLegis (CE) só entrega o arquivo com este cabeçalho; qualquer valor serve.
          ...(/sefazlegis\.sefaz\.ce\.gov\.br/.test(url) && { captchaToken: 'bipae' }),
          ...(cookie && { cookie }),
        },
      },
      (res) => {
        for (const raw of res.headers['set-cookie'] ?? []) {
          const [pair] = raw.split(';');
          const at = pair.indexOf('=');
          jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
        }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(new URL(res.headers.location, url).toString(), jar, hops + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] ?? '') }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('sem resposta em 60 s')));
    req.on('error', reject);
  });
}

const text = ({ body, type }) => body.toString(/iso-8859-1|latin1/i.test(type) ? 'latin1' : 'utf8');
const saved = (key) =>
  gunzipSync(readFileSync(join(sourcesDir, manifest[key].file))).toString('utf8');
const page = async (key) => text(await download(manifest[key].page));

/** Tabela → linhas comparáveis. */
const rows = (value) =>
  Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Object.entries(value ?? {});

const fcp = JSON.parse(readFileSync(join(dataDir, 'fcp.json'), 'utf8'));
const ufByCode = Object.fromEntries(fcp.map((f) => [f.cUF, f.uf]));

/** Páginas guardadas como HTML: o mesmo leitor da geração, no arquivo guardado e na página de hoje. */
const PARSED = [
  {
    title: 'CEST (Convênio ICMS 142/18)',
    keys: ['cest'],
    parse: (p) => parseCest(p.cest, manifest.cest.downloadedAt),
  },
  {
    title: 'Alíquotas por produto (Portal Nacional da DIFAL)',
    keys: ['difal'],
    parse: (p) => parseDifal(p.difal, ufByCode),
  },
  {
    title: 'IVA-ST dos alimentícios em SP (Portaria SRE 12/2026)',
    keys: ['stSpAlimenticios'],
    parse: (p) =>
      parseSpAlimenticios(
        p.stSpAlimenticios,
        new Set(
          JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
        ),
      ),
  },
  {
    title: 'Mercadorias em ST em SP (Portaria CAT 68/2019 consolidada)',
    keys: ['stSpCat68'],
    parse: (p) =>
      parseSpCat68(
        p.stSpCat68,
        new Set(
          JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
        ),
      ),
  },
  {
    title: 'Endereços da NFC-e (SVRS e ENCAT)',
    keys: ['nfceAuthorizers', 'nfceWebservicesEncat', 'nfceQrCode', 'nfceUrlChave'],
    parse: (p) =>
      parseNfceEndpoints({
        svrsHtml: p.nfceAuthorizers,
        encatWsHtml: p.nfceWebservicesEncat,
        qrHtml: p.nfceQrCode,
        chaveHtml: p.nfceUrlChave,
      }),
  },
  {
    // Se uma UF nova passar a usar o cBenef (ou sair da lista), o aviso semanal mostra (F3-27.c).
    title: 'UFs que usam o cBenef (Portal Nacional da NF-e, NT 2019.001)',
    keys: ['cbenefPortalNfe'],
    parse: (p) => {
      const portal = parseCbenefPortal(p.cbenefPortalNfe);
      return [
        ['atualizada em', portal.updatedAt],
        ...portal.listed.map((l) => [l.uf, l.url]),
        ['não usam', portal.notUsed.join(' ')],
      ];
    },
  },
  {
    title: 'Endereços da NF-e (Portal Nacional da NF-e)',
    keys: ['nfeWebservicesProducao', 'nfeWebservicesHomologacao'],
    parse: (p) =>
      parseNfeEndpoints({
        producaoHtml: p.nfeWebservicesProducao,
        homologacaoHtml: p.nfeWebservicesHomologacao,
      }),
  },
];

async function checkParsed(item) {
  const before = Object.fromEntries(item.keys.map((k) => [k, saved(k)]));
  const now = Object.fromEntries(await Promise.all(item.keys.map(async (k) => [k, await page(k)])));
  const old = rows(item.parse(before));
  let fresh;
  try {
    fresh = rows(item.parse(now));
  } catch (error) {
    // O leitor recusou a página nova: o formato ou o conteúdo mudou de um jeito que pede revisão.
    return {
      title: item.title,
      page: manifest[item.keys[0]].page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, fresh);
  return {
    title: item.title,
    page: manifest[item.keys[0]].page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

async function checkNcm() {
  const before = JSON.parse(saved('ncm'));
  const now = JSON.parse(text(await download(manifest.ncm.page)));
  const pick = (raw) =>
    raw.Nomenclaturas.map((n) => [n.Codigo, n.Descricao, n.Data_Inicio, n.Data_Fim]);
  const diff = diffRows(pick(before), pick(now));
  // O cabeçalho ("Vigente em ...") muda todo dia; só os códigos contam.
  const details = [];
  if (diff.changed)
    details.push(
      `${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`,
      ...diff.examples,
    );
  return {
    title: 'NCM (Siscomex)',
    page: manifest.ncm.page,
    status: details.length ? 'mudou' : 'igual',
    details,
  };
}

/** Listas do Portal da NF-e (planilhas, esquemas, notas técnicas): títulos publicados. */
const listingUrls = [
  ...new Set(
    Object.values(manifest)
      .map((s) => s.page)
      .filter((p) => p.includes('listaConteudo')),
  ),
];

/**
 * Páginas da documentação técnica da NFS-e Nacional (F5-13.j): esquemas e anexos publicados e o
 * quadro de implantações em produção e em produção restrita. Esquema novo da produção restrita ou
 * data nova de implantação da NT 009 aparecem como "mudou".
 */
const nfsePageUrls = [
  ...new Set(
    Object.values(manifest)
      .map((s) => s.page)
      .filter((p) =>
        /gov\.br\/nfse\/.*\/documentacao-tecnica\/(producao-restrita|rtc|documentacao-atual|atualizacoes-e-implantacoes)$/.test(
          p,
        ),
      ),
  ),
];
const isNfsePage = (url) => nfsePageUrls.includes(url);

async function currentListings() {
  return Object.fromEntries(
    await Promise.all(
      [...listingUrls, ...nfsePageUrls].map(async (url) => {
        const html = text(await download(url));
        return [url, isNfsePage(url) ? nfsePageEntries(html) : listingTitles(html)];
      }),
    ),
  );
}

async function checkListings() {
  const before = JSON.parse(readFileSync(listingsPath, 'utf8'));
  const now = await currentListings();
  return [...listingUrls, ...nfsePageUrls].map((url) => {
    const { added, removed } = diffTitles(before.listings[url] ?? [], now[url]);
    const changed = added.length > 0 || removed.length > 0;
    const kind = isNfsePage(url) ? 'Página da NFS-e Nacional' : 'Lista do Portal da NF-e';
    const keys = Object.entries(manifest)
      .filter(([, s]) => s.page === url)
      .map(([k]) => k)
      .join(', ');
    return {
      title: `${kind} (${keys})`,
      page: url,
      status: changed ? 'mudou' : 'igual',
      details: [...added.map((t) => `novo: ${t}`), ...removed.map((t) => `saiu: ${t}`)],
    };
  });
}

/** Paraná (PDFs): a resolução e o RICMS inteiro de hoje, lidos como na geração. */
async function checkPr() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const cestNames = new Map(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => [
      c.cest,
      c.description,
    ]),
  );
  const ncmCodes = JSON.parse(readFileSync(join(dataDir, 'ncm.json'), 'utf8'))
    .items.map((n) => n[0])
    .filter((c) => c.length === 8);
  const build = async (resBytes, ricmsBytes) => {
    const res = parsePrRes571(await pdfLines(resBytes), known);
    return prStRows(
      prStReferences(res.tables, parsePrAnexoIX(anexoIXLines(await pdfLines(ricmsBytes))), {
        resUrl: '',
        anexoUrl: '',
        articles: res.articles,
        doorToDoor: res.doorToDoor,
        cestNames,
        ncmCodes,
      }),
    );
  };
  const file = (key) => readFileSync(join(sourcesDir, manifest[key].file));
  const old = await build(file('stPrRes571'), file('stPrAnexoIX'));
  const [res, ricms] = await Promise.all([
    download(manifest.stPrRes571.page),
    download(manifest.stPrAnexoIX.page),
  ]);
  const title = 'ST no Paraná (Resolução SEFA 571/2019 e Anexo IX do RICMS/PR)';
  let fresh;
  try {
    fresh = await build(res.body, ricms.body);
  } catch (error) {
    return {
      title,
      page: manifest.stPrRes571.page,
      status: 'mudou',
      details: [`o PDF novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, fresh);
  return {
    title,
    page: manifest.stPrRes571.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Minas Gerais: as seis páginas da Parte 2 do Anexo XV e as notas, lidas como na geração. */
async function checkMg() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const pages = [6, 7, 8, 9, 10, 11].map((n) => `stMgAnexoXV${n}`);
  const notes = [2, 3, 4].map((n) => `stMgNotas${n}`);
  const build = (get) => {
    const { chapters } = parseMgParte2(pages.map(get), parseMgNotes(notes.map(get)), known);
    const { segment, references } = mgStReferences(chapters, { url: '' });
    return [
      ...references.flatMap((r) =>
        r.items.map((i) => [r.segment, i.item, i.cest, i.ncms.join(' '), i.mva]),
      ),
      ...segment.annexes.flatMap((a) =>
        a.cests.map((c) => [a.annex, c.cest, c.excludedFrom ?? '']),
      ),
    ];
  };
  const latin = (key) =>
    gunzipSync(readFileSync(join(sourcesDir, manifest[key].file))).toString('latin1');
  const old = build(latin);
  const fresh = Object.fromEntries(
    await Promise.all(
      [...pages, ...notes].map(async (k) => [
        k,
        (await download(manifest[k].page)).body.toString('latin1'),
      ]),
    ),
  );
  const title = 'ST em Minas Gerais (RICMS/MG, Anexo XV, Parte 2)';
  let now;
  try {
    now = build((k) => fresh[k]);
  } catch (error) {
    return {
      title,
      page: manifest.stMgAnexoXV6.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stMgAnexoXV6.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Rio Grande do Sul: o texto do RICMS/RS de hoje, lido como na geração. */
async function checkRs() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (html) =>
    parseRsApendiceII(html, known).flatMap((s) =>
      s.items.map((i) => [s.section, s.item, i.item, i.cest, i.ncms.join(' '), i.mva ?? '']),
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stRsRicms.file))).toString('latin1'),
  );
  const title = 'ST no Rio Grande do Sul (RICMS/RS, Apêndice II)';
  let now;
  try {
    now = rowsOf((await download(manifest.stRsRicms.page)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.stRsRicms.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stRsRicms.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Santa Catarina: o Anexo 1-A de hoje, lido como na geração. */
async function checkSc() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (html) =>
    parseScAnexo1A(html, known).flatMap((s) =>
      s.kind === 'current'
        ? s.items.map((i) => [s.roman, i.cest, i.ncms.join(' '), i.mvas.join(' ')])
        : [[s.roman, 'revogada', s.excludedFrom ?? '', s.cests.join(' ')]],
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stScAnexo1A.file))).toString('latin1'),
  );
  const title = 'ST em Santa Catarina (RICMS/SC, Anexo 1-A)';
  let now;
  try {
    now = rowsOf((await download(manifest.stScAnexo1A.page)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.stScAnexo1A.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stScAnexo1A.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Bahia: o PDF do Anexo 1 de hoje, lido como na geração. */
async function checkBa() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = async (bytes) =>
    parseBaAnexo1(await pdfLines(bytes), known).flatMap((s) =>
      s.items.map((i) => [s.segment, i.item, i.cests.join(' '), i.ncms.join(' '), i.mva ?? '']),
    );
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.stBaAnexo1.file)));
  const title = 'ST na Bahia (RICMS/BA, Anexo 1)';
  let now;
  try {
    now = await rowsOf((await download(manifest.stBaAnexo1.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.stBaAnexo1.page,
      status: 'mudou',
      details: [`o PDF novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stBaAnexo1.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Goiás: o Anexo VIII de hoje, lido como na geração. */
async function checkGo() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (html) =>
    parseGoApendiceII(html, known).flatMap((b) =>
      b.alineas.flatMap((a) =>
        a.items.map((i) => [
          b.inciso,
          a.key,
          i.item,
          i.cest,
          i.ncms.join(' '),
          i.mva ?? '',
          b.excludedFrom ?? '',
        ]),
      ),
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stGoAnexoVIII.file))).toString('latin1'),
  );
  const title = 'ST em Goiás (RCTE/GO, Anexo VIII, Apêndice II)';
  let now;
  try {
    now = rowsOf((await download(manifest.stGoAnexoVIII.page)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.stGoAnexoVIII.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stGoAnexoVIII.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Pernambuco: o RICMS/PE consolidado de hoje, lido como na geração (Anexo 37 e 37-A a 37-C). */
async function checkPe() {
  const cest = JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8'));
  const decode = (bytes) => new TextDecoder('windows-1252').decode(bytes);
  const rowsOf = (html) => {
    const r = parsePeAnexo37(html, { segments: cest.segments, cests: cest.items });
    return [
      ...r.chapters.flatMap((c) => c.items.map((i) => [c.chapter, i.cest, i.mva])),
      ...r.tables.flatMap((t) => t.items.map((i) => [t.table, i.cest, i.mva])),
      ...r.skipped.map((c) => [c.chapter, 'fora', c.name]),
    ];
  };
  const old = rowsOf(decode(gunzipSync(readFileSync(join(sourcesDir, manifest.stPeRicms.file)))));
  const title = 'ST em Pernambuco (RICMS/PE, Anexo 37)';
  let now;
  try {
    now = rowsOf(decode((await download(manifest.stPeRicms.page)).body));
  } catch (error) {
    return {
      title,
      page: manifest.stPeRicms.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stPeRicms.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/**
 * Paraíba: cada planilha do Anexo 5 de hoje, lida como na geração. A data da leitura é hoje, então
 * linhas que venceram ou começaram desde o download também aparecem como mudança.
 */
async function checkPb() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const today = new Date().toISOString().slice(0, 10);
  const rowsOf = (path, key) =>
    parsePbSheet(readXlsx(path)[0].rows, { known, date: today, name: key }).items.map((i) => [
      key,
      i.cest,
      i.mva,
      i.ncms.join(' '),
    ]);
  const keys = Object.keys(manifest).filter((k) => k.startsWith('stPbAnexo5_'));
  const old = keys.flatMap((k) => rowsOf(join(sourcesDir, manifest[k].file), k));
  const title = 'ST na Paraíba (RICMS/PB, Anexo 5, planilhas da SEFAZ-PB)';
  const page = manifest[keys[0]].page;
  let now;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'bipae-st-pb-'));
    now = [];
    for (const k of keys) {
      const tmp = join(dir, `${k}.xlsx`);
      writeFileSync(tmp, (await download(manifest[k].page)).body);
      now.push(...rowsOf(tmp, k));
    }
  } catch (error) {
    return {
      title,
      page,
      status: 'mudou',
      details: [`uma planilha nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Simples Nacional: os Anexos I a V da LC 123/2006 compilada de hoje, lidos como na geração. */
async function checkSimples() {
  const rowsOf = (html) =>
    parseSimplesAnnexes(html).flatMap((a) =>
      a.brackets.map((b) => [a.annex, b.bracket, b.upToCents, b.rate, b.deductionCents]),
    );
  const decode = (buffer) => new TextDecoder('windows-1252').decode(buffer);
  const old = rowsOf(decode(gunzipSync(readFileSync(join(sourcesDir, manifest.lc123.file)))));
  const title = 'Anexos do Simples Nacional (LC 123/2006)';
  let now;
  try {
    now = rowsOf(decode((await download(manifest.lc123.page)).body));
  } catch (error) {
    return {
      title,
      page: manifest.lc123.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.lc123.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} faixa(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Mato Grosso: a Portaria 195/2019 consolidada de hoje, lida como na geração. */
async function checkMt() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (html) => {
    const r = parseMtPortaria195(html, known);
    return [
      ...r.rows.map((i) => [i.item, i.cest, i.mva, i.ncms.join(' ')]),
      ...r.ranges.map((x) => [x.inciso, x.spans.flat().join(' '), x.mva]),
    ];
  };
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stMtPortaria195.file))).toString('latin1'),
  );
  const title = 'ST em Mato Grosso (Portaria 195/2019-SEFAZ/MT)';
  let now;
  try {
    now = rowsOf((await download(manifest.stMtPortaria195.page)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.stMtPortaria195.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stMtPortaria195.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/**
 * PA, PI e SE no Portal Nacional da ST: a planilha guardada contra a mesma de hoje e contra a
 * página da UF no portal, que ganha uma versão nova quando a UF manda outra planilha.
 */
async function checkConfazSt(key) {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (path) =>
    parseConfazSt(readXlsx(path), { known }).flatMap((s) =>
      s.items.map((i) => [s.name, i.cest, i.mva, i.label ?? '']),
    );
  const page = manifest[key].page;
  const title = `ST no Portal Nacional do CONFAZ (${key.slice(-2).toUpperCase()})`;
  const old = rowsOf(join(sourcesDir, manifest[key].file));
  let now;
  let newer;
  try {
    const tmp = join(mkdtempSync(join(tmpdir(), 'bipae-st-confaz-')), 'planilha.xlsx');
    writeFileSync(tmp, (await download(page)).body);
    now = rowsOf(tmp);
    // A página da UF lista as versões; uma planilha nova aparece com outro endereço.
    const folder = page.slice(0, page.lastIndexOf('/'));
    const html = (await download(folder)).body.toString('utf8');
    newer = [...html.matchAll(/href="([^"]+\.xlsx)"/g)]
      .map((m) => m[1])
      .filter((u, i, all) => all.indexOf(u) === i)
      .slice(0, 1)
      .filter((u) => u !== page);
  } catch (error) {
    return {
      title,
      page,
      status: 'mudou',
      details: [`não deu para ler a planilha: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  const details = [
    ...(newer.length > 0 ? [`versão nova no portal: ${newer[0]}`] : []),
    ...(diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : []),
  ];
  return { title, page, status: details.length > 0 ? 'mudou' : 'igual', details };
}

/** Rio de Janeiro: o .doc do Anexo I de hoje, lido como na geração. */
async function checkRj() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = async (bytes) =>
    parseRjAnexoI(await docText(bytes), known).flatMap((s) =>
      s.items.map((i) => [s.name, i.item, i.cest, i.ncms.join(' '), i.mva ?? '']),
    );
  const old = await rowsOf(gunzipSync(readFileSync(join(sourcesDir, manifest.stRjAnexoI.file))));
  const title = 'ST no Rio de Janeiro (RICMS/RJ, Livro II, Anexo I)';
  let now;
  try {
    now = await rowsOf((await download(manifest.stRjAnexoI.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.stRjAnexoI.page,
      status: 'mudou',
      details: [`o arquivo novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stRjAnexoI.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Mato Grosso do Sul: o .doc do Subanexo I do Anexo III de hoje, lido como na geração. */
async function checkMs() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = async (bytes) =>
    parseMsSubanexoI(await docText(bytes), known).flatMap((t) => [
      ...t.items.map((i) => [t.roman, i.item, i.cest, i.ncms.join(' '), i.mva ?? '']),
      ...t.revoked.map((cest) => [t.roman, 'revogado', cest, t.excludedFrom ?? '', '']),
    ]);
  const old = await rowsOf(gunzipSync(readFileSync(join(sourcesDir, manifest.stMsAnexoIII.file))));
  const title = 'ST em Mato Grosso do Sul (RICMS/MS, Anexo III, Subanexo I)';
  let now;
  try {
    now = await rowsOf((await download(manifest.stMsAnexoIII.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.stMsAnexoIII.page,
      status: 'mudou',
      details: [`o arquivo novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stMsAnexoIII.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Espírito Santo: a Portaria 16-R atualizada de hoje, lida como na geração. */
async function checkEs() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (html) =>
    parseEsPortaria16R(html, known).flatMap((s) =>
      s.items.map((i) => [s.roman, i.item, i.cest, i.ncms.join(' '), i.mva ?? '']),
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stEsPortaria16R.file))).toString('latin1'),
  );
  const title = 'ST no Espírito Santo (Portaria 16-R/2019 atualizada)';
  let now;
  try {
    now = rowsOf((await download(manifest.stEsPortaria16R.page)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.stEsPortaria16R.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stEsPortaria16R.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Alagoas: o PDF de hoje, pela API do portal da SEFAZ-AL (devolve o arquivo em base64). */
async function checkAl() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = async (bytes) =>
    parseAlDecreto90309(await pdfLines(bytes), known).flatMap((a) =>
      a.items.map((i) => [
        a.annex,
        i.item,
        i.cest,
        i.ncms.join(' '),
        i.mva ?? '',
        i.excludedFrom ?? '',
      ]),
    );
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.stAlDecreto90309.file)));
  const key = new URL(manifest.stAlDecreto90309.page).searchParams.get('key');
  const api = `https://gcs.sefaz.al.gov.br/sfz-gcs-api/api/documentos/visualizarDocumento?key=${encodeURIComponent(key)}`;
  const title = 'ST em Alagoas (Decreto 90.309/2023)';
  let now;
  try {
    const json = JSON.parse((await download(api)).body.toString('utf8'));
    now = await rowsOf(Buffer.from(json.arquivo.base64, 'base64'));
  } catch (error) {
    return {
      title,
      page: manifest.stAlDecreto90309.page,
      status: 'mudou',
      details: [`o arquivo novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stAlDecreto90309.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Ceará: o RICMS/CE de 1997 de hoje, pelo SefazLegis (veículos novos, arts. 561 e 562). */
async function checkCe() {
  const rowsOf = async (bytes) =>
    parseCeVeiculos(await pdfLines(bytes)).items.map((i) => [i.cest, i.mva, i.validFrom]);
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.stCeRicms97.file)));
  const title = 'ST no Ceará (RICMS/CE de 1997, veículos novos)';
  let now;
  try {
    now = await rowsOf((await download(manifest.stCeRicms97.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.stCeRicms97.page,
      status: 'mudou',
      details: [`o PDF novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stCeRicms97.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/**
 * Ceará: os decretos de carga líquida (Lei 14.237/2008) de hoje, pelo SefazLegis. Compara as CNAE
 * dos anexos, a margem, os acréscimos e todas as tabelas do Anexo III, com a data de cada redação.
 */
async function checkCeNetLoads() {
  const rowsOf = async (source, bytes) => {
    const p = parseCeNetLoadSource(source, await pdfLines(bytes));
    return [
      ...p.buyers.map((b) => [source, 'CNAE', b.cnae, b.group, b.validFrom ?? '']),
      [
        source,
        'margem',
        p.mva ?? '',
        JSON.stringify(p.simplesAddition),
        JSON.stringify(p.importAddition),
      ],
      ...p.versions.flatMap((v) =>
        v.rows.map((r) => [
          source,
          v.validFrom,
          v.validTo ?? '',
          r.group,
          r.goodsClass,
          ...r.values,
        ]),
      ),
    ];
  };
  const title = 'ST no Ceará (carga líquida por CNAE, Lei 14.237/2008)';
  const page = CE_NET_LOAD_SOURCES.map((s) => manifest[s].page).join(' ');
  const old = [];
  const now = [];
  for (const source of CE_NET_LOAD_SOURCES) {
    old.push(...(await rowsOf(source, readFileSync(join(sourcesDir, manifest[source].file)))));
    try {
      now.push(...(await rowsOf(source, (await download(manifest[source].page)).body)));
    } catch (error) {
      return {
        title,
        page,
        status: 'mudou',
        details: [
          `${manifest[source].title}: o PDF novo não passa no leitor do Bipaê: ${error.message}`,
        ],
      };
    }
  }
  const diff = diffRows(old, now);
  return {
    title,
    page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/**
 * Ceará, F3-26.d.CE.f: instruções normativas que alteram a IN SEFAZ 148/2024 (lista de produtos de
 * informática). O Diário Oficial não tem busca por ato e a busca do SefazLegis pede captcha; os
 * cadernos saem por endereço fixo pela data. O monitor lê os cadernos dos últimos 8 dias (a rodada
 * é semanal, com um dia de folga) e avisa quando um ato novo cita a IN 148/2024.
 */
async function checkCeIn148() {
  const days = Array.from({ length: 8 }, (_, n) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(Date.now() - n * 86_400_000),
    ),
  );
  const found = [];
  const failed = [];
  let read = 0;
  // Caderno que não existe responde HTTP 300 (o dia acabou, ou não teve Diário); erro de rede é
  // tentado de novo e, se persistir, entra no relatório para ninguém achar que o dia foi lido.
  const fetchPart = async (url) => {
    for (let tries = 1; ; tries++) {
      try {
        return (await download(url)).body;
      } catch (error) {
        if (/^HTTP \d/.test(error.message)) return null;
        if (tries === 3) throw error;
      }
    }
  };
  for (const day of days) {
    for (let part = 1; part <= 9; part++) {
      const url = ceDoeUrl(day, part);
      let body;
      try {
        body = await fetchPart(url);
      } catch (error) {
        failed.push(`${url}: ${error.message}`);
        break;
      }
      if (!body || body.subarray(0, 4).toString() !== '%PDF') break;
      read++;
      for (const m of ceIn148Mentions(await pdfLines(body))) {
        found.push(`${url}: ${m.act ?? 'ato sem título de instrução normativa'} — "${m.excerpt}"`);
      }
    }
  }
  if (read === 0) throw new Error('nenhum caderno do Diário Oficial abriu nos últimos 8 dias');
  const unread = failed.map((f) => `Não abriu (confira à mão): ${f}`);
  return {
    title: 'Lista de informática do Ceará (IN SEFAZ 148/2024)',
    page: ceDoeUrl(days[0], 1),
    status: found.length ? 'mudou' : failed.length ? 'erro' : 'igual',
    details: found.length
      ? [
          `${read} caderno(s) lido(s); ato(s) citando a IN 148/2024 (guarde o caderno em sources/, acrescente a IN em CE_INFORMATICS_ACTS e no import-tables e regere):`,
          ...found,
          ...unread,
        ]
      : unread,
  };
}

/**
 * Acre: o PDF anexado hoje à página da IN DIAT 1/2023 no portal da SEFAZ-AC (link "mdocs-file").
 * Se a SEFAZ-AC publicar outra instrução normativa, a lista da página de legislação do ICMS
 * também precisa ser olhada: o aviso diz quando o anexo some ou muda.
 */
async function checkAc() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = async (bytes) =>
    parseAcIn12023(await pdfLines(bytes), known).segments.flatMap((s) =>
      s.items.map((i) => [s.code, i.item, i.cest, i.ncms.join(' '), i.mva ?? '']),
    );
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.stAcIn12023.file)));
  const title = 'ST no Acre (IN DIAT 1/2023, Anexo I)';
  let now;
  try {
    const page = (await download(manifest.stAcIn12023.page)).body.toString('utf8');
    const link = /href="(https:\/\/sefaz\.ac\.gov\.br\/2021\/\?mdocs-file=\d+)"/.exec(page);
    if (!link) throw new Error('a página não traz mais o link do anexo');
    now = await rowsOf((await download(link[1])).body);
  } catch (error) {
    return {
      title,
      page: manifest.stAcIn12023.page,
      status: 'mudou',
      details: [`o arquivo novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stAcIn12023.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Amazonas: a Lei 6.108/2022 de hoje no SILT (o documento sai pelo identificador da norma). */
async function checkAm() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (html) =>
    parseAmLei6108(html, known).annexes.flatMap((a) =>
      a.items.map((i) => [a.annex, i.item, i.cest, i.ncms.join(' '), i.mvas.join(' ')]),
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stAmLei6108.file))).toString('latin1'),
  );
  const uuid = /\/lei\/([0-9a-f-]{36})\//.exec(manifest.stAmLei6108.page)[1];
  const title = 'ST no Amazonas (Lei 6.108/2022)';
  let now;
  try {
    const doc = `https://sistemas.sefaz.am.gov.br/get/Normas.do?metodo=viewDoc&uuidDoc=${uuid}`;
    now = rowsOf((await download(doc)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.stAmLei6108.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stAmLei6108.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/**
 * Rio Grande do Norte: o PDF do Anexo 007 que a SEFAZ-RN publica hoje na pasta do RICMS vigente.
 * Compara as linhas com MVA, os CEST de cada segmento e os segmentos que saíram da ST; um decreto
 * novo que mude só o texto também aparece pela data de atualização.
 */
async function checkRn() {
  const cest = JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8'));
  const rowsOf = async (bytes) => {
    const parsed = parseRnAnexo007(
      await pdfLines(bytes, { withoutStruck: true }),
      await pdfLines(bytes),
      { segments: cest.segments, cests: cest.items },
    );
    return [
      ['atualizado até', parsed.updatedBy, parsed.updatedAt],
      ...parsed.sections.flatMap((s) => [
        ...s.items.map((i) => [s.roman, s.segment, i.item, i.cest, i.ncms.join(' ')]),
        ...s.groups.flatMap((g) => g.items.map((i) => [s.roman, 'MVA', i.item, i.cest, i.mva])),
      ]),
      ...parsed.removed.flatMap((r) =>
        r.items.map((i) => ['fora da ST', r.segment, i.cest, r.excludedFrom, r.excludedBy]),
      ),
    ];
  };
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.stRnAnexo007.file)));
  const title = 'ST no Rio Grande do Norte (RICMS/RN, Anexo 007)';
  let now;
  try {
    now = await rowsOf((await download(manifest.stRnAnexo007.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.stRnAnexo007.page,
      status: 'mudou',
      details: [`o arquivo novo não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stRnAnexo007.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/**
 * Maranhão: os Anexos 4.x do RICMS/MA de hoje, pela API do portal da SEFAZ-MA (repositório
 * "Anexos do RICMS"). Arquivo trocado no portal ganha outro identificador: o novo é baixado e
 * passa pelo leitor do Bipaê para mostrar o que mudou.
 */
async function checkMa() {
  const cests = JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items;
  const title = 'ST no Maranhão (RICMS/MA, Anexos 4.x)';
  const page = manifest.stMaAnexo4_2.page;
  const get = async (url) => (await download(url)).body.toString('utf8');
  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  };
  const token = await maPortalLogin(get, post);
  const list = await fetch(
    `${MA_PORTAL_API}/portal/arquivos?descricao=${encodeURIComponent('ANEXO 4')}&pageSize=500&page=0`,
    { headers: { AuthorizationPortal: token } },
  ).then((r) => r.json());
  const files = list.items.filter((i) => i.idRepositorio === MA_ANNEX_REPOSITORY);
  const rowsOf = (annex, lines) =>
    parseMaAnnex(annex, lines, cests).items.map((i) => [
      annex,
      i.item,
      i.cest,
      i.ncms.join(' '),
      i.mva,
    ]);
  const details = [];
  let changed = false;
  for (const { annex, key } of MA_ANNEX_SOURCES) {
    const id = /identificador=([0-9a-f-]{36})/.exec(manifest[key].page)[1];
    const name = new RegExp(`^anexo ${annex.replace('.', '\\.')}(\\.pdf$|\\s)`, 'i');
    const now = files.filter((f) => name.test(f.nomeArquivoOriginal));
    if (now.length === 1 && now[0].identificador === id) continue;
    changed = true;
    if (now.length !== 1) {
      details.push(`Anexo ${annex}: ${now.length} arquivo(s) com esse nome no portal`);
      continue;
    }
    try {
      const old = rowsOf(annex, await pdfLines(readFileSync(join(sourcesDir, manifest[key].file))));
      const bytes = (
        await download(
          `${MA_PORTAL_API}/portal/arquivos/public/identificador?identificador=${now[0].identificador}`,
        )
      ).body;
      const diff = diffRows(old, rowsOf(annex, await pdfLines(bytes)));
      details.push(
        `Anexo ${annex}: arquivo novo (${now[0].identificador}); ${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`,
        ...diff.examples,
      );
    } catch (error) {
      details.push(`Anexo ${annex}: o arquivo novo não passa no leitor do Bipaê: ${error.message}`);
    }
  }
  return { title, page, status: changed ? 'mudou' : 'igual', details };
}

/** Rondônia: o Anexo VI de hoje, pela API do portal de legislação da SEFIN-RO. */
async function checkRo() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (json) =>
    parseRoAnexoVI(JSON.parse(json).texto_html, known).flatMap((s) =>
      s.items.map((i) => [i.item, i.cest, i.ncms.join(' '), i.mva]),
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stRoAnexoVI.file))).toString('utf8'),
  );
  const title = 'ST em Rondônia (RICMS/RO, Anexo VI)';
  let now;
  try {
    now = rowsOf((await download(manifest.stRoAnexoVI.page)).body.toString('utf8'));
  } catch (error) {
    return {
      title,
      page: manifest.stRoAnexoVI.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stRoAnexoVI.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Distrito Federal: o Caderno I do Anexo IV de hoje, pela API do portal de legislação da Receita-DF. */
async function checkDf() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const rowsOf = (json) =>
    parseDfAnexoIV(JSON.parse(json).Documento, known).items.flatMap((i) =>
      i.rows.map((r) => [
        String(i.number),
        r.group ?? '',
        r.sub,
        r.cests.join(' '),
        r.ncmText,
        r.mvas.join(' '),
      ]),
    );
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.stDfAnexoIV.file))).toString('utf8'),
  );
  const title = 'ST no Distrito Federal (RICMS/DF, Anexo IV, Caderno I)';
  let now;
  try {
    // A página de visualização é montada no navegador; o texto vem desta API (POST).
    const res = await fetch(DF_LEGISLATION_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER['user-agent'] },
      body: JSON.stringify(DF_ANEXO_IV_REQUEST),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    now = rowsOf(await res.text());
  } catch (error) {
    return {
      title,
      page: manifest.stDfAnexoIV.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.stDfAnexoIV.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} linha(s) nova(s) ou alterada(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** cBenef do Paraná: o PDF de hoje (se a SEFA-PR publicar outra versão, o endereço muda e avisa). */
async function checkCbenefPr() {
  const rowsOf = async (bytes) =>
    parseCbenefPr(await pdfItems(bytes)).map((c) => [
      c.code,
      c.csts.join(' '),
      c.from ?? '',
      c.to ?? '',
    ]);
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.cbenefPr.file)));
  const title = 'cBenef do Paraná (tabela por CST da SEFA-PR)';
  let now;
  try {
    now = await rowsOf((await download(manifest.cbenefPr.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.cbenefPr.page,
      status: 'mudou',
      details: [`o arquivo não abre ou não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.cbenefPr.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** cBenef de Santa Catarina: a Tabela 5.2A de hoje. */
async function checkCbenefSc() {
  const rowsOf = async (bytes) =>
    parseCbenefSc(await pdfItems(bytes)).map((c) => [
      c.code,
      c.csts.join(' '),
      c.from ?? '',
      c.to ?? '',
    ]);
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.cbenefSc.file)));
  const title = 'cBenef de Santa Catarina (Tabela 5.2A)';
  let now;
  try {
    now = await rowsOf((await download(manifest.cbenefSc.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.cbenefSc.page,
      status: 'mudou',
      details: [`o arquivo não abre ou não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.cbenefSc.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** cBenef do Rio Grande do Sul: a planilha de hoje (o endereço muda a cada versão publicada). */
async function checkCbenefRs() {
  const rowsOf = (path) =>
    parseCbenefRs(readXlsx(path)).map((c) => [c.code, c.csts.join(' '), c.from ?? '', c.to ?? '']);
  const old = rowsOf(join(sourcesDir, manifest.cbenefRs.file));
  const title = 'cBenef do Rio Grande do Sul (Tabela cBenef x CST)';
  let now;
  try {
    const tmp = join(mkdtempSync(join(tmpdir(), 'bipae-cbenef-')), 'rs.xlsx');
    writeFileSync(tmp, (await download(manifest.cbenefRs.page)).body);
    now = rowsOf(tmp);
  } catch (error) {
    return {
      title,
      page: manifest.cbenefRs.page,
      status: 'mudou',
      details: [
        `o arquivo não abre ou não passa no leitor do Bipaê (talvez uma versão nova): ${error.message}`,
      ],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.cbenefRs.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** cBenef de Goiás: a IN 1.518/2022 consolidada de hoje. */
async function checkCbenefGo() {
  const rowsOf = (html) => parseCbenefGo(html).map((c) => [c.code, c.csts.join(' '), c.to ?? '']);
  const old = rowsOf(
    gunzipSync(readFileSync(join(sourcesDir, manifest.cbenefGo.file))).toString('latin1'),
  );
  const title = 'cBenef de Goiás (IN 1.518/2022-GSE)';
  let now;
  try {
    now = rowsOf((await download(manifest.cbenefGo.page)).body.toString('latin1'));
  } catch (error) {
    return {
      title,
      page: manifest.cbenefGo.page,
      status: 'mudou',
      details: [`a página nova não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.cbenefGo.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** Ajuste SINIEF 02/18 (venda condicional): as regras das notas lidas do texto de hoje. */
async function checkDemonstration() {
  const title = 'Notas da venda condicional (Ajuste SINIEF 02/18)';
  const page = manifest.ajusteSinief0218.page;
  const old = parseDemonstration(
    readFileSync(join(sourcesDir, manifest.ajusteSinief0218.file), 'utf8'),
  );
  let now;
  try {
    now = parseDemonstration((await download(page)).body.toString('utf8'));
  } catch (error) {
    return {
      title,
      page,
      status: 'mudou',
      details: [`o texto não passa no leitor do Bipaê: ${error.message}`],
    };
  }
  const changed = JSON.stringify(old) !== JSON.stringify(now);
  return {
    title,
    page,
    status: changed ? 'mudou' : 'igual',
    details: changed
      ? ['natureza, CFOP, textos ou prazo das notas mudaram no texto do Ajuste']
      : [],
  };
}

/**
 * cBenef em planilha (ES e DF): compara a planilha de hoje com a guardada (a versão nova muda o
 * nome do arquivo e às vezes o leitor deixa de reconhecê-la).
 */
async function checkCbenefSheet(key, parse, title) {
  const rowsOf = (path) =>
    parse(readXlsx(path)).map((c) => [c.code, c.csts.join(' '), c.from ?? '', c.to ?? '']);
  const old = rowsOf(join(sourcesDir, manifest[key].file));
  let now;
  try {
    const tmp = join(mkdtempSync(join(tmpdir(), 'bipae-cbenef-')), 'tabela.xlsx');
    writeFileSync(tmp, (await download(manifest[key].page)).body);
    now = rowsOf(tmp);
  } catch (error) {
    return {
      title,
      page: manifest[key].page,
      status: 'mudou',
      details: [
        `o arquivo não abre ou não passa no leitor do Bipaê (talvez uma versão nova): ${error.message}`,
      ],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest[key].page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

const checkCbenefEs = () =>
  checkCbenefSheet('cbenefEs', parseCbenefEs, 'cBenef do Espírito Santo (planilha cBenef ES)');

const checkCbenefDf = () =>
  checkCbenefSheet(
    'cbenefDf',
    parseCbenefDf,
    'cBenef do Distrito Federal (Anexo Único do Ato Declaratório)',
  );

/** cBenef de São Paulo: a planilha de hoje (cada versão nova muda o nome do arquivo). */
async function checkCbenefSp() {
  const rowsOf = (path) =>
    parseCbenefSp(readXlsx(path)).map((c) => [c.code, c.csts.join(' '), c.to ?? '']);
  const old = rowsOf(join(sourcesDir, manifest.cbenefSp.file));
  const title = 'cBenef de São Paulo (Tabela CST x cBenef)';
  let now;
  try {
    const tmp = join(mkdtempSync(join(tmpdir(), 'bipae-cbenef-')), 'sp.xlsx');
    writeFileSync(tmp, (await download(manifest.cbenefSp.page)).body);
    now = rowsOf(tmp);
  } catch (error) {
    return {
      title,
      page: manifest.cbenefSp.page,
      status: 'mudou',
      details: [
        `o arquivo não abre ou não passa no leitor do Bipaê (talvez uma versão nova): ${error.message}`,
      ],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.cbenefSp.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

/** cBenef do Rio de Janeiro: o PDF de hoje (com os cabeçalhos de navegador que a SEFAZ-RJ exige). */
async function checkCbenefRj() {
  const rowsOf = async (bytes) =>
    parseCbenefRj(await pdfItems(bytes)).map((c) => [
      c.code,
      c.csts.join(' '),
      c.from ?? '',
      c.to ?? '',
    ]);
  const old = await rowsOf(readFileSync(join(sourcesDir, manifest.cbenefRj.file)));
  const title = 'cBenef do Rio de Janeiro (Tabela de códigos de benefício X CST)';
  let now;
  try {
    now = await rowsOf((await download(manifest.cbenefRj.page)).body);
  } catch (error) {
    return {
      title,
      page: manifest.cbenefRj.page,
      status: 'mudou',
      details: [
        `o arquivo não abre ou não passa no leitor do Bipaê (talvez uma versão nova): ${error.message}`,
      ],
    };
  }
  const diff = diffRows(old, now);
  return {
    title,
    page: manifest.cbenefRj.page,
    status: diff.changed ? 'mudou' : 'igual',
    details: diff.changed
      ? [`${diff.added} código(s) novo(s) ou alterado(s), ${diff.removed} saíram`, ...diff.examples]
      : [],
  };
}

const safe = async (title, page, fn) => {
  try {
    return await fn();
  } catch (error) {
    return { title, page, status: 'erro', details: [error.message] };
  }
};

const today = new Date().toISOString().slice(0, 10);

if (process.argv.includes('--save-listings')) {
  writeFileSync(
    listingsPath,
    `${JSON.stringify({ savedAt: today, listings: await currentListings() }, null, 2)}\n`,
  );
  console.log(`Títulos guardados em ${listingsPath}`);
} else {
  const results = [
    ...(await Promise.all(
      PARSED.map((item) => safe(item.title, manifest[item.keys[0]].page, () => checkParsed(item))),
    )),
    await safe('NCM (Siscomex)', manifest.ncm.page, checkNcm),
    await safe('ST no Paraná', manifest.stPrRes571.page, checkPr),
    await safe('ST em Minas Gerais', manifest.stMgAnexoXV6.page, checkMg),
    await safe('ST no Rio Grande do Sul', manifest.stRsRicms.page, checkRs),
    await safe('ST em Santa Catarina', manifest.stScAnexo1A.page, checkSc),
    await safe('ST na Bahia', manifest.stBaAnexo1.page, checkBa),
    await safe('ST em Goiás', manifest.stGoAnexoVIII.page, checkGo),
    await safe('ST em Pernambuco', manifest.stPeRicms.page, checkPe),
    await safe('ST na Paraíba', manifest.stPbAnexo5_01.page, checkPb),
    await safe('ST em Mato Grosso', manifest.stMtPortaria195.page, checkMt),
    await safe('Anexos do Simples Nacional', manifest.lc123.page, checkSimples),
    await safe('ST do Pará (Portal do CONFAZ)', manifest.stConfazPa.page, () =>
      checkConfazSt('stConfazPa'),
    ),
    await safe('ST do Piauí (Portal do CONFAZ)', manifest.stConfazPi.page, () =>
      checkConfazSt('stConfazPi'),
    ),
    await safe('ST de Sergipe (Portal do CONFAZ)', manifest.stConfazSe.page, () =>
      checkConfazSt('stConfazSe'),
    ),
    await safe('ST no Rio de Janeiro', manifest.stRjAnexoI.page, checkRj),
    await safe('ST em Mato Grosso do Sul', manifest.stMsAnexoIII.page, checkMs),
    await safe('ST no Espírito Santo', manifest.stEsPortaria16R.page, checkEs),
    await safe('ST em Alagoas', manifest.stAlDecreto90309.page, checkAl),
    await safe('ST em Rondônia', manifest.stRoAnexoVI.page, checkRo),
    await safe('ST no Ceará', manifest.stCeRicms97.page, checkCe),
    await safe('ST no Distrito Federal', manifest.stDfAnexoIV.page, checkDf),
    await safe('ST no Acre', manifest.stAcIn12023.page, checkAc),
    await safe('ST no Amazonas', manifest.stAmLei6108.page, checkAm),
    await safe('ST no Rio Grande do Norte', manifest.stRnAnexo007.page, checkRn),
    await safe('ST no Maranhão', manifest.stMaAnexo4_2.page, checkMa),
    await safe('ST no Ceará (carga líquida)', manifest.stCeCargaAutopecas.page, checkCeNetLoads),
    await safe(
      'Lista de informática do Ceará (IN SEFAZ 148/2024)',
      manifest.stCeInformaticaIn148.page,
      checkCeIn148,
    ),
    await safe('cBenef do Paraná', manifest.cbenefPr.page, checkCbenefPr),
    await safe('cBenef de Santa Catarina', manifest.cbenefSc.page, checkCbenefSc),
    await safe('cBenef do Rio Grande do Sul', manifest.cbenefRs.page, checkCbenefRs),
    await safe('cBenef de Goiás', manifest.cbenefGo.page, checkCbenefGo),
    await safe('cBenef do Espírito Santo', manifest.cbenefEs.page, checkCbenefEs),
    await safe('cBenef de São Paulo', manifest.cbenefSp.page, checkCbenefSp),
    await safe('cBenef do Rio de Janeiro', manifest.cbenefRj.page, checkCbenefRj),
    await safe('cBenef do Distrito Federal', manifest.cbenefDf.page, checkCbenefDf),
    await safe(
      'Venda condicional (Ajuste SINIEF 02/18)',
      manifest.ajusteSinief0218.page,
      checkDemonstration,
    ),
    ...(await safe(
      'Listas do Portal da NF-e e páginas da NFS-e Nacional',
      [...listingUrls, ...nfsePageUrls].join(' '),
      checkListings,
    ).then((r) => (Array.isArray(r) ? r : [r]))),
  ];
  const report = reportMarkdown(results, today);
  console.log(report);
  const at = process.argv.indexOf('--report');
  if (at > 0) writeFileSync(process.argv[at + 1], report);
  process.exitCode = results.some((r) => r.status === 'mudou') ? 2 : 0;
}
