/**
 * Anexos I a V da LC 123/2006 (redação da LC 155/2016, em vigor desde 01/01/2018), lidos do texto
 * compilado do Planalto: as seis faixas de cada anexo, com a receita bruta em 12 meses, a alíquota
 * nominal e o valor a deduzir. Deles sai a alíquota efetiva do Simples (art. 18, § 1º-A).
 */
const ANNEXES = ['I', 'II', 'III', 'IV', 'V'];

const cents = (text) => Number(text.replace(/\./g, '').replace(',', ''));
const plain = (html) =>
  html
    .replace(/<[^>]*>/gs, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

/** `html` já decodificado (o arquivo do Planalto vem em windows-1252). */
export function parseSimplesAnnexes(html) {
  return ANNEXES.map((annex, index) => {
    // O anexo em vigor tem a âncora com ponto ("anexoiii."); a sem ponto é a redação revogada.
    const start = html.indexOf(`name="anexo${annex.toLowerCase()}."`);
    if (start < 0) throw new Error(`LC 123/2006: Anexo ${annex} em vigor não encontrado`);
    const next = ANNEXES[index + 1];
    const end = next ? html.indexOf(`name="anexo${next.toLowerCase()}"`, start) : -1;
    const text = plain(html.slice(start, end > start ? end : start + 200_000));
    const title = /Alíquotas e Partilha do Simples Nacional\s*[-–]\s*(.+?)\s+Receita Bruta/.exec(
      text,
    )?.[1];
    const brackets = [];
    const re =
      /(\d)\s*a\s*Faixa\s+(?:Até|De\s+[\d.]+,\d{2}\s+a)\s+([\d.]+,\d{2})\s+(\d{1,2},\d{2})\s*%\s+(–|-|[\d.]+,\d{2})/g;
    for (const m of text.matchAll(re)) {
      if (brackets.length === 6) break;
      brackets.push({
        bracket: Number(m[1]),
        upToCents: cents(m[2]),
        rate: m[3].replace(',', '.'),
        deductionCents: /\d/.test(m[4]) ? cents(m[4]) : 0,
      });
    }
    if (!title || brackets.length !== 6 || brackets.some((b, i) => b.bracket !== i + 1)) {
      throw new Error(`LC 123/2006: Anexo ${annex} com ${brackets.length} faixas lidas`);
    }
    const clean = title
      .trim()
      .replace(/(\d) o\b/g, '$1º')
      .replace(/ -([A-Z])/g, '-$1');
    return { annex, title: clean, brackets };
  });
}
