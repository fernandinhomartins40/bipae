// Confere se as fontes fiscais oficiais mudaram desde o que está guardado em sources/ (F3-31).
//
// Uso:
//   node scripts/check-sources.mjs                 mostra o relatório (sai com 2 se algo mudou)
//   node scripts/check-sources.mjs --report r.md   também grava o relatório em Markdown
//   node scripts/check-sources.mjs --save-listings guarda os títulos atuais das listas do Portal
//
// Nada é atualizado sozinho: quem atualiza troca o arquivo oficial e regera as tabelas.
import https from 'node:https';
import tls from 'node:tls';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseCest } from './cest.mjs';
import { parseDifal } from './difal.mjs';
import { parseSpAlimenticios } from './st-sp.mjs';
import { parseNfceEndpoints } from './nfce-endpoints.mjs';
import { parseNfeEndpoints } from './nfe-endpoints.mjs';
import { diffRows, diffTitles, listingTitles, reportMarkdown } from './sources-watch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcesDir = join(root, 'sources');
const dataDir = join(root, 'src/tables/data');
const manifest = JSON.parse(readFileSync(join(sourcesDir, 'manifest.json'), 'utf8'));
const listingsPath = join(sourcesDir, 'listings.json');

// Alguns portais da SEFAZ usam a cadeia da ICP-Brasil, que não vem na lista padrão do Node.
const icp = JSON.parse(readFileSync(join(dataDir, 'icp-brasil.json'), 'utf8')).map((c) => c.pem);
// Os certificados do sistema cobrem servidores que não mandam o intermediário (o Windows e o
// Ubuntu completam a cadeia).
const system = typeof tls.getCACertificates === 'function' ? tls.getCACertificates('system') : [];
const ca = [...new Set([...tls.rootCertificates, ...system, ...icp])];

/** GET com redirecionamentos e cookies (o Portal da NF-e exige os dois). */
function download(url, jar = new Map(), hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 10) return reject(new Error('redirecionamentos demais'));
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = https.get(
      url,
      {
        ca,
        timeout: 60_000,
        headers: { 'user-agent': 'Mozilla/5.0 (Bipae fontes)', ...(cookie && { cookie }) },
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

async function currentListings() {
  return Object.fromEntries(
    await Promise.all(
      listingUrls.map(async (url) => [url, listingTitles(text(await download(url)))]),
    ),
  );
}

async function checkListings() {
  const before = JSON.parse(readFileSync(listingsPath, 'utf8'));
  const now = await currentListings();
  return listingUrls.map((url) => {
    const { added, removed } = diffTitles(before.listings[url] ?? [], now[url]);
    const changed = added.length > 0 || removed.length > 0;
    return {
      title: `Lista do Portal da NF-e (${Object.entries(manifest)
        .filter(([, s]) => s.page === url)
        .map(([k]) => k)
        .join(', ')})`,
      page: url,
      status: changed ? 'mudou' : 'igual',
      details: [...added.map((t) => `novo: ${t}`), ...removed.map((t) => `saiu: ${t}`)],
    };
  });
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
    ...(await safe('Listas do Portal da NF-e', listingUrls.join(' '), checkListings).then((r) =>
      Array.isArray(r) ? r : [r],
    )),
  ];
  const report = reportMarkdown(results, today);
  console.log(report);
  const at = process.argv.indexOf('--report');
  if (at > 0) writeFileSync(process.argv[at + 1], report);
  process.exitCode = results.some((r) => r.status === 'mudou') ? 2 : 0;
}
