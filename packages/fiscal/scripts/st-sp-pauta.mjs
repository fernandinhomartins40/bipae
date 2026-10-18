// Extrai, do texto oficial da Portaria SRE 27/2026 (SP), a pauta da substituição tributária de
// refrigerantes, energéticos e hidroeletrolíticos, cerveja e chope: o preço final em reais de cada
// marca, embalagem e tamanho (Capítulo I dos Anexos I a III), e o IVA-ST do Capítulo II, que vale
// quando não se usa a pauta (artigo 2º). Nenhum valor é digitado à mão (F3-26.f).

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"' };

const textOf = (html) =>
  html
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/[\u200b\u00a0]/g, ' ')
    .replace(/\s+/g, ' ');

const ANNEX_NAMES = {
  I: 'Refrigerantes',
  II: 'Bebidas energéticas e hidroeletrolíticas',
  III: 'Cerveja e chope',
};

/** "1.234,56" → 123456 */
const centsOf = (text) => Math.round(Number(text.replace(/[.\s]/g, '').replace(',', '.')) * 100);

export function parseSpPauta(html, known) {
  const text = textOf(html);
  const annexes = [...text.matchAll(/ANEXO (I{1,3}) - [A-ZÇÃÕÁÉÍÓÚ ,]+? CAPÍTULO I - /g)];
  if (annexes.length !== 3) throw new Error(`Portaria SRE 27/2026: ${annexes.length} anexos`);
  const items = [];
  const iva = [];
  const unknown = new Set();
  for (let a = 0; a < annexes.length; a++) {
    const annex = annexes[a][1];
    const body = text.slice(annexes[a].index, annexes[a + 1]?.index ?? text.length);
    const ch2 = body.indexOf('CAPÍTULO II - IVA-ST');
    if (ch2 < 0) throw new Error(`Portaria SRE 27/2026, Anexo ${annex}: sem o Capítulo II`);
    const ch1 = body.slice(0, ch2);
    // Tabelas por fabricante: "TABELA 1. Coca Cola Item CEST Marca ...".
    const tables = [
      ...ch1.matchAll(
        /TABELA (\d+)\. (.+?) Item CEST Marca Tipo de embalagem Tamanho Preço final/g,
      ),
    ];
    if (tables.length === 0) throw new Error(`Portaria SRE 27/2026, Anexo ${annex}: sem tabelas`);
    for (let t = 0; t < tables.length; t++) {
      const rows = ch1.slice(
        tables[t].index + tables[t][0].length,
        tables[t + 1]?.index ?? ch1.length,
      );
      for (const m of rows.matchAll(
        /(\d+\.\d+) (\d{2}\.\d{3}\.\d{2}) (.+?) R\$ ?(\d{1,3}(?:\.\d{3})*, ?\d{2})/g,
      )) {
        const cest = m[2].replace(/\D/g, '');
        if (!known.has(cest)) unknown.add(cest);
        items.push({
          annex,
          table: Number(tables[t][1]),
          tableName: tables[t][2].trim(),
          item: m[1],
          cest,
          description: m[3].replace(/\*+/g, '').replace(/\s+/g, ' ').trim(),
          priceCents: centsOf(m[4]),
        });
      }
    }
    // Capítulo II: "I - 66% ... nas saídas de fabricante ..." e "II - na hipótese de o
    // estabelecimento varejista receber mercadoria diretamente de outro Estado ...: a) 20% ...".
    const ch2text = body.slice(ch2).split(/ Comentário /)[0];
    const retail = ch2text.indexOf('II - na hipótese de o estabelecimento varejista');
    const parts = [
      {
        who: 'saídas de fabricante, engarrafador, importador, distribuidor, depósito, atacadista ou arrematante',
        text: ch2text.slice(0, retail < 0 ? undefined : retail),
      },
      ...(retail < 0
        ? []
        : [
            {
              who: 'varejista que recebe direto de outra UF não signatária',
              text: ch2text.slice(retail),
            },
          ]),
    ];
    for (const p of parts) {
      for (const m of p.text.matchAll(/(\d{1,3})% \([^)]*\),? (?:para |nas saídas)?([^;.]*)/g)) {
        iva.push({
          annex,
          who: p.who,
          mva: m[1],
          applies: m[2].replace(/^\s*(?:para\s+)?/, '').trim(),
        });
      }
    }
  }
  if (items.length < 500)
    throw new Error(`Portaria SRE 27/2026: só ${items.length} linhas de pauta`);
  if (iva.length < 10) throw new Error(`Portaria SRE 27/2026: só ${iva.length} IVA-ST`);
  return { items, iva, unknown: [...unknown].sort(), annexNames: ANNEX_NAMES };
}
