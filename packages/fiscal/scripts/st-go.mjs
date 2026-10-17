// Extrai, do Anexo VIII do RCTE/GO (Decreto 4.852/1997, página da Secretaria da Economia de Goiás),
// o Apêndice II: mercadorias em substituição tributária por inciso e alínea, com CEST, NCM e a MVA
// das operações internas (F3-26.d.GO). O texto traz cada redação antiga antes da nova: vale a
// última ocorrência de cada inciso, alínea e subitem. Incisos que saíram da ST viram "saiu da ST"
// com a data do texto. Nenhum valor é digitado à mão.

const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  sect: '§',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  atilde: 'ã',
  otilde: 'õ',
  Atilde: 'Ã',
  Otilde: 'Õ',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  Acirc: 'Â',
  Ecirc: 'Ê',
  Ocirc: 'Ô',
  agrave: 'à',
  Agrave: 'À',
  ccedil: 'ç',
  Ccedil: 'Ç',
  uuml: 'ü',
  ndash: '–',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
};

const textOf = (html) =>
  html
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/\s+/g, ' ')
    .replace(/[\u0096\u0097]/g, '–')
    .trim();

const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const MVA = /^\d{1,3}(?:,\d{1,2})?$/;
const NCM_TOKEN = /^\d{4}(?:\.?\d{1,2}){0,2}$|^\d{2}$|^\d{8}$/;
const INCISO = /^([IVXL]+)\s*[-–]\s*(.+)$/;
const ALINEA = /^([A-Z])\s*[)–-]\s*(.+)$/;

/** "01.03.18" → "2018-03-01" */
const isoFromGo = (text) => {
  const m = /(\d{2})\.(\d{2})\.(\d{2,4})/.exec(text);
  if (!m) return null;
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}`;
};

/**
 * @param html página ANEXO_08_Substituicao_Tributaria.htm
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseGoApendiceII(html, knownCest) {
  const start = html.search(/name=["']?APII_VIGOR/);
  const end = html.search(/name=["']?APIII\b/);
  if (start < 0 || end < start) throw new Error('Não achei o Apêndice II do Anexo VIII do RCTE/GO');
  const body = html.slice(start, end);

  // Cada ocorrência de inciso abre um bloco; a última de cada número é a vigente.
  const blocks = [];
  let block = null;
  let alinea = null;
  let label = null;
  const problems = [];

  for (const m of body.matchAll(/<table[\s\S]*?<\/table>|<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (m[1] !== undefined) {
      const text = textOf(m[1]);
      const inc = INCISO.exec(text);
      if (inc && inc[2].length > 3 && !/^\d/.test(inc[2])) {
        const excluded =
          /exclu[íi]das da sistem[áa]tica da Substitui[çc][ãa]o Tribut[áa]ria pelo Decreto n[ºo°]?\s*([\d.]+)\s*a partir de\s*(\d{2}\.\d{2}\.\d{2,4})/i.exec(
            inc[2],
          );
        block = {
          inciso: inc[1],
          name: inc[2].replace(/\s*\(.*$/, '').trim(),
          revoked: /^Revogado/i.test(inc[2]),
          excludedFrom: excluded ? isoFromGo(excluded[2]) : null,
          excludedBy: excluded ? `Decreto ${excluded[1]}` : null,
          alineas: new Map(),
        };
        blocks.push(block);
        alinea = null;
        label = null;
      }
      continue;
    }
    if (!block) continue;
    for (const row of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => textOf(c[1]));
      if (cells.length === 0) continue;
      const head = ALINEA.exec(cells[0]);
      if (cells.length === 1 && head && /[A-ZÀ-Ú]{3}/.test(head[2])) {
        // A mesma alínea pode vir de novo (redação nova): recomeça do zero.
        alinea = {
          key: head[1],
          name: head[2].replace(/\s*\(Reda[çc][ãa]o.*$/i, '').trim(),
          items: new Map(),
        };
        block.alineas.set(head[1], alinea);
        label = null;
        continue;
      }
      if (!alinea) {
        alinea = { key: '-', name: block.name, items: new Map() };
        block.alineas.set('-', alinea);
      }
      // "1.0) na operação em que o remetente for industrial...": rótulo dos subitens de baixo.
      const lab = /^(\d+\.0)\)\s*(.+)$/.exec(cells[0]);
      if (lab) label = lab[2].replace(/\s*\(Reda[çc][ãa]o.*$/i, '').trim();
      const revokedSub = cells.length <= 2 && /^(\d+(?:\.\d+)+)\s*REVOGAD/i.exec(cells.join(' '));
      if (revokedSub) {
        alinea.items.delete(revokedSub[1]);
        continue;
      }
      const cestAt = cells.findIndex((c) => CEST.test(c));
      if (cestAt < 1) continue;
      const cest = cells[cestAt].replace(/\./g, '');
      const ncmCell = cells[cestAt + 1] ?? '';
      const ncms = [
        ...new Set(
          ncmCell
            .split(/[\s,;]+/)
            .map((t) => t.replace(/\.$/, ''))
            .filter((t) => NCM_TOKEN.test(t))
            .map((t) => t.replace(/\./g, '')),
        ),
      ];
      const mva = cells.slice(cestAt + 2).find((c) => MVA.test(c)) ?? null;
      const description = cells[cestAt - 1].replace(/\s*\(Reda[çc][ãa]o conferida.*$/i, '').trim();
      const sub = cells
        .slice(0, cestAt - 1)
        .reverse()
        .find((c) => /^\d+(?:\.\d+)+$/.test(c));
      const key = sub ?? `${cest}`;
      // Alguns CEST antigos (já tirados do Convênio ICMS 142/18) seguem no texto; o NCM identifica.
      alinea.items.set(key, {
        item: key,
        cest,
        ncms,
        ncmText: ncmCell,
        description: label ? `${description} — ${label}` : description,
        mva: mva ? mva.replace(',', '.') : null,
      });
    }
  }
  if (problems.length > 0)
    throw new Error(`RCTE/GO, Apêndice II: ${[...new Set(problems)].slice(0, 10).join('; ')}`);

  const last = new Map();
  for (const b of blocks) last.set(b.inciso, b);
  const result = [...last.values()].map((b) => ({
    inciso: b.inciso,
    name: b.name,
    revoked: b.revoked,
    excludedFrom: b.excludedFrom,
    excludedBy: b.excludedBy,
    alineas: [...b.alineas.values()].map((a) => ({
      key: a.key,
      name: a.name,
      items: [...a.items.values()],
    })),
  }));
  const total = result
    .filter((b) => !b.excludedFrom && !b.revoked)
    .reduce((n, b) => n + b.alineas.reduce((k, a) => k + a.items.length, 0), 0);
  if (total < 150) throw new Error(`Esperava o Apêndice II inteiro; achei ${total} itens`);
  // Conferência: quase todo CEST em vigor tem de estar no Convênio ICMS 142/18.
  const current = result
    .filter((b) => !b.excludedFrom && !b.revoked)
    .flatMap((b) => b.alineas.flatMap((a) => a.items));
  const unknown = current.filter((i) => !knownCest.has(i.cest));
  if (unknown.length > current.length / 10) {
    throw new Error(`RCTE/GO: ${unknown.length} CEST em vigor fora do Convênio ICMS 142/18`);
  }
  return result;
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Apêndice II no formato de st-references.json. */
export function goStReferences(incisos, { url }) {
  const annexes = incisos
    .filter((b) => !b.revoked)
    .map((b) => {
      const items = b.alineas.flatMap((a) => a.items);
      const cests = [...new Map(items.map((i) => [i.cest, i.ncms])).entries()].map(
        ([cest, ncms]) => (ncms.length > 0 ? { cest, ncms } : { cest }),
      );
      return {
        annex: b.inciso,
        name: sentence(b.name),
        cests,
        ...(b.excludedFrom && { excludedFrom: b.excludedFrom, excludedBy: b.excludedBy }),
      };
    })
    .filter((a) => a.cests.length > 0);
  const references = incisos
    .filter((b) => !b.revoked && !b.excludedFrom)
    .flatMap((b) =>
      b.alineas.map((a) => ({
        uf: 'GO',
        segment: a.key === '-' ? b.inciso : `${b.inciso}-${a.key}`,
        segmentName: a.key === '-' ? sentence(b.name) : `${sentence(b.name)}: ${sentence(a.name)}`,
        act: `RCTE/GO, Anexo VIII, Apêndice II, inciso ${b.inciso}`,
        source: 'stGoAnexoVIII',
        url,
        validFrom: '2017-01-01',
        validTo: null,
        note: 'MVA das operações internas. A tabela também traz a MVA para as entradas com 4%, 7% e 12%. Onde a MVA muda conforme quem vende (industrial ou atacadista), a descrição diz qual é. Vale a redação atual.',
        items: a.items.filter((i) => i.mva && i.ncms.length > 0),
      })),
    )
    .filter((r) => r.items.length > 0);
  return {
    segment: {
      uf: 'GO',
      act: 'RCTE/GO, Anexo VIII, Apêndice II (redação atual)',
      source: 'stGoAnexoVIII',
      url,
      annexes,
    },
    references,
  };
}
