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
import { parseSpCat68 } from './st-sp-cat68.mjs';
import { anexoIXLines, parsePrAnexoIX, parsePrRes571, prStReferences, prStRows } from './st-pr.mjs';
import { pdfLines } from './pdf-text.mjs';
import { mgStReferences, parseMgNotes, parseMgParte2 } from './st-mg.mjs';
import { parseRsApendiceII } from './st-rs.mjs';
import { parseScAnexo1A } from './st-sc.mjs';
import { parseBaAnexo1 } from './st-ba.mjs';
import { parseGoApendiceII } from './st-go.mjs';
import { parseRjAnexoI } from './st-rj.mjs';
import { parseEsPortaria16R } from './st-es.mjs';
import { parseAlDecreto90309 } from './st-al.mjs';
import { parseRoAnexoVI } from './st-ro.mjs';
import { docText } from './doc-text.mjs';
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
// A SEFAZ-RJ recusa pedidos sem os cabeçalhos de um navegador comum (mostra uma página de bloqueio).
const BROWSER = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-BR,pt;q=0.9',
  'upgrade-insecure-requests': '1',
};

function download(url, jar = new Map(), hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 10) return reject(new Error('redirecionamentos demais'));
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const req = https.get(
      url,
      {
        ca,
        timeout: 60_000,
        headers: {
          ...(/fazenda\.rj\.gov\.br/.test(url)
            ? BROWSER
            : { 'user-agent': 'Mozilla/5.0 (Bipae fontes)' }),
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

/** Paraná (PDFs): a resolução e o RICMS inteiro de hoje, lidos como na geração. */
async function checkPr() {
  const known = new Set(
    JSON.parse(readFileSync(join(dataDir, 'cest.json'), 'utf8')).items.map((c) => c.cest),
  );
  const build = async (resBytes, ricmsBytes) =>
    prStRows(
      prStReferences(
        parsePrRes571(await pdfLines(resBytes), known).tables,
        parsePrAnexoIX(anexoIXLines(await pdfLines(ricmsBytes))),
        { resUrl: '', anexoUrl: '' },
      ),
    );
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
    await safe('ST no Rio de Janeiro', manifest.stRjAnexoI.page, checkRj),
    await safe('ST no Espírito Santo', manifest.stEsPortaria16R.page, checkEs),
    await safe('ST em Alagoas', manifest.stAlDecreto90309.page, checkAl),
    await safe('ST em Rondônia', manifest.stRoAnexoVI.page, checkRo),
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
