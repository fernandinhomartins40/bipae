// Extrai, da página do Portal Nacional da DIFAL guardada em sources/, as alíquotas internas de
// ICMS por mercadoria de cada UF: descrição, NCM (quando a página informa), alíquota, FCP, base
// legal e data da atualização. Nenhum valor é digitado à mão.

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', ordm: 'º', ordf: 'ª' };

/** Texto de um trecho de HTML: sem tags, entidades resolvidas e espaços normalizados. */
export function htmlText(html) {
  return html
    .replace(/<\/p>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** "20,5%" → "20.5"; o que não é um percentual simples fica null (o texto original é guardado). */
export function percentText(text) {
  const m = /^(\d{1,2}(?:,\d{1,4})?)\s*%$/.exec(text.trim());
  return m ? m[1].replace(',', '.') : null;
}

/** NCM citados no campo (2 a 8 dígitos, com ou sem pontos): servem para achar a linha pelo produto. */
export function ncmCodes(text) {
  const codes = [...text.matchAll(/\b\d{2}(?:\.?\d{2}){0,3}\b/g)].map((m) =>
    m[0].replace(/\./g, ''),
  );
  return [...new Set(codes.filter((code) => code.length >= 2 && code.length <= 8))];
}

const isoDate = (br) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * @param html página do portal
 * @param ufByCode código IBGE da UF (cUF) → sigla
 */
export function parseDifal(html, ufByCode) {
  const sections = [...html.matchAll(/data-target="#CodUf-(\d+)"/g)];
  if (sections.length !== 27)
    throw new Error(`Esperava 27 UFs no portal da DIFAL, achei ${sections.length}`);
  const result = [];
  sections.forEach((section, i) => {
    const uf = ufByCode[section[1]];
    if (!uf) throw new Error(`Código de UF desconhecido no portal da DIFAL: ${section[1]}`);
    const end = sections[i + 1]?.index ?? html.length;
    const body = html.slice(section.index, end);
    const items = [];
    const item =
      /<tr data-toggle="collapse" data-parent="#tabelaExpansiva2"[\s\S]*?<td>([\s\S]*?)<\/td>\s*<\/tr>\s*<tr>\s*<td colspan="3"[\s\S]*?<div id="\d+" class="collapse">([\s\S]*?)<\/table>/g;
    for (const m of body.matchAll(item)) {
      const fields = {};
      for (const f of m[2].matchAll(/<label>([^<]+)<\/label><\/td>\s*<td>([\s\S]*?)<\/td>/g)) {
        fields[htmlText(f[1])] = htmlText(f[2]);
      }
      const rateText = fields['Alíquota interna'] ?? '';
      const fcpText = fields['Fundo de Combate à Pobreza'] ?? '';
      const ncmText = fields['NCM/SH (se aplicável)'] ?? '';
      const updatedAt = isoDate(fields['Data da atualização'] ?? '');
      const description = htmlText(m[1]);
      items.push({
        description,
        general: /^regra geral$/i.test(description),
        ...(ncmText && { ncmText, ncms: ncmCodes(ncmText) }),
        rateText,
        rate: percentText(rateText),
        ...(fcpText && { fcpText, fcp: percentText(fcpText) }),
        note: fields['Observação'] ?? '',
        // Algumas linhas vêm sem data: ficam como data desconhecida.
        updatedAt,
      });
    }
    result.push({ uf, items });
  });
  return result.sort((a, b) => a.uf.localeCompare(b.uf));
}

const GENERAL = /regra geral|al[ií]quota modal|al[ií]quota padr[ãa]o|demais mercadorias/i;

/**
 * Junta o portal com a alíquota geral confirmada na lei de cada UF (icms-uf.json). Quando a linha
 * geral do portal não bate com a lei, o portal está atrasado naquela UF: as linhas com data até a
 * da linha geral ficam marcadas como defasadas.
 */
export function markStale(portal, confirmed) {
  return portal.map(({ uf, items }) => {
    const general = items.find(
      (i) => GENERAL.test(i.description) && !/vigente at[ée]/i.test(i.description),
    );
    const law = confirmed.find((c) => c.uf === uf);
    const confirmedRate = law?.status === 'confirmado' ? law.rate : null;
    const matches =
      general?.rate && confirmedRate ? Number(general.rate) === Number(confirmedRate) : null;
    return {
      uf,
      portalGeneralRate: general?.rate ?? null,
      confirmedGeneralRate: confirmedRate,
      generalMatches: matches,
      items: items.map((item) => ({
        ...item,
        description: item.description.replace(/\s*\n\s*/g, ' '),
        general: item === general,
        stale: matches === false && (!item.updatedAt || item.updatedAt <= general.updatedAt),
      })),
    };
  });
}
