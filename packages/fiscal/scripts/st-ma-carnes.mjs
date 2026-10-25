// Carnes no Maranhão (F3-26.d.MA.d): o Anexo 4.4 do RICMS/MA (Decreto 19.714/2003) não usa a
// alíquota interna sobre a base da ST. A base é o valor da operação com seguro e encargos mais a
// margem de 25% (art. 5º) e o imposto é uma carga fixa sobre ela (art. 6º, e o art. 11 deixa
// aplicar a carga direto sobre a base): 3% na entrada interestadual (I), 1% na saída interestadual
// do frigorífico credenciado (II) e 0,75% nas operações internas (III). O regime vale para qualquer
// adquirente do Estado (art. 1º), não pela CNAE, e o anexo não traz NCM nem CEST: a classe do
// produto é escolha da empresa, e o credenciamento do frigorífico (Portaria 178/2025-GABIN) é
// configuração dela.
//
// Tudo sai do texto: o anexo consolidado do portal da SEFAZ-MA (a redação em vigor, antes de
// "Redação Anterior"), os Decretos 39.823/2025 e 39.824/2025 (data do DOE e o mesmo percentual do
// anexo) e a portaria do credenciamento (data do DOE e os incisos que ela alcança). Nenhum
// percentual é digitado à mão.

/** Fontes no sources/manifest.json. */
export const MA_MEAT_SOURCES = {
  annex: 'stMaAnexo4_4',
  entryDecree: 'stMaDecreto39823',
  internalDecree: 'stMaDecreto39824',
  accreditation: 'stMaPortaria178',
};

const join = (lines) => lines.join(' ').replace(/\s+/g, ' ');
const pct = (text) => text.replace(',', '.');

/** "DOE n° 50, de 18.03.25" → "2025-03-18". */
function doeDate(text, what) {
  const m = /DOE n[°º.]?\s*\d+,? de (\d{2})\.(\d{2})\.(\d{2})\b/.exec(text);
  if (!m) throw new Error(`${what}: não achei a data do DOE`);
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

/** A última ocorrência de um padrão (a redação em vigor vem depois das anteriores). */
function last(text, re, what) {
  const all = [...text.matchAll(re)];
  if (all.length === 0) throw new Error(`RICMS/MA, Anexo 4.4: não achei ${what}`);
  return all[all.length - 1];
}

/**
 * Lê o Anexo 4.4 e os atos que mudaram o art. 6º.
 * @param annexLines linhas do PDF do anexo
 * @param acts linhas dos PDFs { entryDecree (39.823), internalDecree (39.824), accreditation }
 */
export function parseMaMeatAnnex(annexLines, acts) {
  const full = join(annexLines);
  const cut = full.indexOf('Redação Anterior');
  if (cut < 0) throw new Error('RICMS/MA, Anexo 4.4: não achei a "Redação Anterior"');
  const text = full.slice(0, cut);
  const mva = last(
    text,
    /Art\. 5º A base de cálculo.*?acrescida da margem de valor agregado de (\d+(?:,\d+)?)%/g,
    'a margem do art. 5º',
  )[1];
  const entry = last(
    text,
    /I – (\d+(?:,\d+)?)% \([^)]*\), relativo às operações de entradas interestaduais/g,
    'o inciso I do art. 6º',
  );
  const exit = last(
    text,
    /II ?- (\d+(?:,\d+)?)% \([^)]*\), relativo às operações de saídas interestaduais de produtos comestíveis[^(]*\(NR – Decreto n° ([\d.]+)\/25\)/g,
    'o inciso II do art. 6º',
  );
  const internal = last(
    text,
    /III ?[–-] (\d+(?:,\d+)?)% \([^)]*\),? nas operações internas com gado bovino e bubalino destinados ao abate, bem como os produtos comestíveis[^(]*\(NR – Decreto n° ([\d.]+)\/25\)/g,
    'o inciso III do art. 6º',
  );
  // As duas redações novas são dos decretos guardados; o percentual tem que ser o mesmo nos dois.
  const entryAct = join(acts.entryDecree);
  const internalAct = join(acts.internalDecree);
  if (exit[2] !== '39.823' || !entryAct.includes(`DECRETO ${exit[2]}`)) {
    throw new Error(`RICMS/MA, Anexo 4.4: o inciso II não é do Decreto 39.823 (${exit[2]})`);
  }
  if (internal[2] !== '39.824' || !internalAct.includes(`DECRETO ${internal[2]}`)) {
    throw new Error(`RICMS/MA, Anexo 4.4: o inciso III não é do Decreto 39.824 (${internal[2]})`);
  }
  if (!entryAct.includes(`II - ${exit[1]}% (`)) {
    throw new Error('Decreto 39.823/2025: o percentual do inciso II não bate com o do anexo');
  }
  if (!internalAct.includes(`III – ${internal[1]}% (`)) {
    throw new Error('Decreto 39.824/2025: o percentual do inciso III não bate com o do anexo');
  }
  const note = last(
    text,
    /§ 1º Na saída subsequente de mercadoria tributada.*?expressão “([^“”.]+)/g,
    'a expressão do § 1º do art. 6º',
  )[1].trim();
  const transferNote = last(
    text,
    /§ 2º Na transferência interna.*?expressão “([^“”.]+)/g,
    'a expressão do § 2º do art. 6º',
  )[1].trim();
  if (note !== transferNote) {
    throw new Error('RICMS/MA, Anexo 4.4: as expressões dos §§ 1º e 2º do art. 6º não batem');
  }
  for (const [paragraph, inciso] of [
    ['§ 6º', 'inciso II'],
    ['§ 7º', 'inciso III'],
  ]) {
    if (
      !new RegExp(`${paragraph} Ato do Secretário.*?credenciamento.*?${inciso} deste artigo`).test(
        text,
      )
    ) {
      throw new Error(`RICMS/MA, Anexo 4.4: não achei o credenciamento do ${paragraph}`);
    }
  }
  if (
    !/Art\. 3º Nas entradas neste Estado, bem como nas saídas internas, de gado bovino e bubalino, destinado a frigorífico.*?ficam diferidos/.test(
      text,
    )
  ) {
    throw new Error('RICMS/MA, Anexo 4.4: não achei o diferimento do art. 3º');
  }
  const portaria = join(acts.accreditation);
  if (
    !/credenciamento de frigoríficos.*?incisos II e III do art\. 6º do Anexo 4\.4/.test(portaria)
  ) {
    throw new Error(
      'Portaria 178/2025-GABIN: não fala dos incisos II e III do art. 6º do Anexo 4.4',
    );
  }
  if (!/Esta Portaria entra em vigor na data de sua publicação/.test(portaria)) {
    throw new Error('Portaria 178/2025-GABIN: a vigência mudou de forma');
  }
  if (!/Este Decreto entra em vigor na data de sua publicação/.test(internalAct)) {
    throw new Error('Decreto 39.824/2025: a vigência mudou de forma');
  }
  return {
    mva: pct(mva),
    interstateEntry: pct(entry[1]),
    interstateExitAccredited: pct(exit[1]),
    internalAccredited: pct(internal[1]),
    outputNote: note,
    entryDecreeDate: doeDate(entryAct, 'Decreto 39.823/2025'),
    internalDecreeDate: doeDate(internalAct, 'Decreto 39.824/2025'),
    accreditationDate: doeDate(portaria, 'Portaria 178/2025-GABIN'),
  };
}

/**
 * O regime "por produto" do Anexo 4.4 no formato de st-net-loads.json (`productRegimes`).
 * @param parsed resultado de `parseMaMeatAnnex`
 * @param ctx urls das fontes, a tabela do CEST e a da NCM
 */
export function maMeatRegime(parsed, { urls, cests, ncms }) {
  // Quando pedir a classe do produto: os NCM dos CEST de carne de gado do Convênio ICMS 142/18
  // (17.083.00 e 17.084.00) e a posição da NCM dos bovinos vivos. Só serve para a compra perguntar;
  // quem diz se o produto está no anexo é a empresa (o CEST 17.084.00 inclui a carne ovina, que o
  // anexo não cita; D-045).
  const askCests = ['1708300', '1708400'];
  const askNcm = new Set();
  for (const code of askCests) {
    const item = cests.find((c) => c.cest === code);
    if (!item) throw new Error(`Anexo 4.4: CEST ${code} fora do Convênio ICMS 142/18`);
    for (const n of item.ncm) askNcm.add(n);
  }
  const live = ncms.find((n) => n[0] === '0102');
  if (!live || !/espécie bovina/i.test(live[1])) {
    throw new Error('Anexo 4.4: a posição 0102 da NCM não é mais a dos bovinos vivos');
  }
  askNcm.add('0102');
  // A redação em vigor do art. 6º é a dos dois decretos de 2025 (o inciso I não mudou com eles):
  // a tabela começa no mais recente. Antes disso o Bipaê não tem a redação ("sem tabela").
  const validFrom = [parsed.entryDecreeDate, parsed.internalDecreeDate].sort().at(-1);
  return {
    uf: 'MA',
    id: 'ma-carnes',
    act: 'RICMS/MA, Anexo 4.4',
    source: MA_MEAT_SOURCES.annex,
    url: urls.annex,
    segmentName: 'Carne bovina e bubalina, gado bovino e bubalino',
    mva: parsed.mva,
    classes: [
      { goodsClass: 'ma-cattle', label: 'Gado bovino ou bubalino (Anexo 4.4)' },
      {
        goodsClass: 'ma-meat',
        label: 'Produtos comestíveis da matança de gado bovino ou bubalino (Anexo 4.4)',
      },
    ],
    askNcm: [...askNcm].sort(),
    outputNote: parsed.outputNote,
    accreditation: {
      act: 'Portaria 178/2025-GABIN',
      source: MA_MEAT_SOURCES.accreditation,
      url: urls.accreditation,
      validFrom: parsed.accreditationDate,
    },
    versions: [
      {
        validFrom,
        validTo: null,
        amendedBy: 'Decretos 39.823/2025 e 39.824/2025',
        interstateEntry: parsed.interstateEntry,
        interstateExitAccredited: parsed.interstateExitAccredited,
        internalAccredited: parsed.internalAccredited,
      },
    ],
  };
}
