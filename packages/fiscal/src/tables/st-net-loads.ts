import { dec, fromCents, percent, toCents, type RoundingMode } from '../decimal';
import data from './data/st-net-loads.json';

/**
 * Substituição tributária com carga líquida (F3-26.d.CE.b): no Ceará, o estabelecimento cuja
 * CNAE-Fiscal principal está nos anexos do decreto do segmento (Lei 14.237/2008) recolhe a ST
 * como um percentual fixo sobre o valor da nota de entrada (acrescido da margem, quando o decreto
 * manda), e não como MVA × alíquota menos o crédito. O percentual depende de quem compra, da carga
 * interna da mercadoria e da origem. Tudo vem dos decretos guardados em sources/.
 *
 * Cálculo puro: a regra de ICMS da empresa (MVA, alíquota e crédito) não usa a carga líquida. A
 * entrada da compra calcula a ST de entrada por `stNetLoadFor` com a CNAE principal da empresa e a
 * classe da mercadoria do produto (F3-26.d.CE.c), e o rascunho da NF-e põe a expressão do decreto
 * na saída interna (`stNetLoadOutputNote`). Quem escolhe a classe da mercadoria e confirma que o
 * produto está no regime é a empresa (dúvida D-042).
 */

/** Coluna de origem da tabela: o próprio Estado ou o exterior; N/NE/CO e ES; Sul e Sudeste sem o ES. */
export type NetLoadOriginKey = 'internal' | 'n-ne-co-es' | 's-se-except-es';

export interface NetLoadOrigin {
  key: NetLoadOriginKey;
  /** Como o decreto escreve o cabeçalho da coluna. */
  label: string;
  ufs: string[];
  /** A coluna também vale para a importação direta do exterior. */
  abroad: boolean;
}

/** Atacadista (Anexo I), varejista (Anexo II), indústria do Anexo I ou todos (farmacêuticos). */
export type NetLoadBuyerGroup = 'wholesale' | 'retail' | 'industry' | 'all';

export interface NetLoadBuyer {
  cnae: string;
  description: string;
  /** Data de inclusão da CNAE no anexo, quando uma nota do decreto a dá. */
  validFrom: string | null;
  group: NetLoadBuyerGroup;
}

export type NetLoadPercents = Partial<Record<NetLoadOriginKey, string>>;

export interface NetLoadRow {
  group: NetLoadBuyerGroup;
  /** Classe da mercadoria pela carga interna ("basket-7", "rate-20", "informatics"...). */
  goodsClass: string;
  /** Rótulo da linha como está no decreto. */
  label: string;
  percents: NetLoadPercents;
}

export interface NetLoadVersion {
  validFrom: string;
  validTo: string | null;
  amendedBy: string | null;
  /** A tabela tem a linha da indústria com "Normal" (sem carga líquida na entrada). */
  industryNormal: boolean;
  loads: NetLoadRow[];
}

export interface NetLoadRegime {
  uf: string;
  id: string;
  act: string;
  law: string;
  source: string;
  url: string;
  segmentName: string;
  /** Só a CNAE-Fiscal principal do estabelecimento conta (art. 1º de cada decreto). */
  cnaeBasis: 'principal';
  /** Segmentos do CEST alcançados; null quando o decreto vale para as mercadorias do estabelecimento. */
  cestSegments: string[] | null;
  /** Margem de valor agregado do artigo do cálculo, em percentual; null quando não há. */
  mva: string | null;
  groups: { group: NetLoadBuyerGroup; label: string }[];
  buyers: NetLoadBuyer[];
  /** Acréscimo quando o fornecedor é do Simples Nacional, por origem. */
  simplesAddition: NetLoadPercents | null;
  /** Acréscimo no importado a 4% (Resolução do Senado 13/2012) vindo de outra UF, por origem. */
  importAddition: NetLoadPercents | null;
  /**
   * Expressão que a nota da saída interna seguinte leva ("ICMS retido por substituição
   * tributária", seguida do número do decreto; art. 7º, § 1º, ou o equivalente de cada decreto).
   */
  outputNote: string;
  /**
   * Comprador optante pelo Simples Nacional: o decreto não se aplica a ele (`excluded`, vestuário,
   * art. 3º) ou usa outra margem (`mva`, móveis, art. 3º, § 8º). Null quando o decreto não diz nada.
   */
  simplesBuyer: { rule: 'excluded' | 'mva'; mva: string | null } | null;
  /** Margem na entrada em transferência entre estabelecimentos do mesmo titular (F3-26.d.CE.d). */
  transfer: NetLoadTransferRule;
  /** Regime Especial de Tributação (RET) do atacadista; null quando o decreto não tem. */
  specialRegime: NetLoadSpecialRegime | null;
  /** Retenção da indústria nas saídas internas (art. 2º); null quando o decreto não tem. */
  industry: NetLoadIndustryRule | null;
  /** Da redação atual para as anteriores. */
  versions: NetLoadVersion[];
}

/**
 * Transferência: "será o valor do documento fiscal ..., acrescida da MVA" (`document`: a margem
 * troca a do cálculo) ou "será a definida no caput deste artigo, acrescida de X%" (`caput`).
 * `interstateOnly`: o parágrafo só fala das "oriundas de outras unidades da Federação".
 */
export interface NetLoadTransferRule {
  basis: 'document' | 'caput';
  interstateOnly: boolean;
  internalMva: string | null;
  interstateMva: string | null;
}

/** Tabela da saída do RET dos farmacêuticos por canal (Decreto 36.617, arts. 8º a 10). */
export interface NetLoadExitTable {
  channel: 'hospital' | 'pharma' | 'distribution-center';
  validFrom: string;
  sale: { goodsClass: string; label: string; percent: string }[];
  transfer: { goodsClass: string; label: string; percent: string }[] | null;
  /** Adicional do importado a 4% na saída interna. */
  importAddition: string | null;
  /** Adicional do importado a 4% na saída interestadual. */
  interstateImportAddition: string | null;
}

export type NetLoadSpecialRegime =
  | {
      /** "Poderá aplicar, como carga líquida, aquela prevista no Anexo III" (arts. 4º/5º). */
      kind: 'annex-iii';
      article: string;
      /** A carga "poderá ser ajustada, proporcionalmente" no termo do regime. */
      adjustable: boolean;
    }
  | {
      /** Cargas próprias do RET (farmacêuticos). Base: o valor do documento, sem margem. */
      kind: 'own-table';
      article: string;
      adjustable: boolean;
      /** Entrada vinda de outra UF (art. 6º). */
      entry: NetLoadPercents;
      /** Entrada em transferência (art. 6º). */
      transfer: NetLoadPercents;
      simplesAddition: NetLoadPercents;
      /** Centro de distribuição que comprova 50% de transferências (art. 7º). */
      distributionCenter: NetLoadPercents;
      /** Entre atacadistas com RET, o ICMS fica diferido para a saída (art. 11). */
      internalBetweenWholesalersDeferred: boolean;
      /** O importado a 4% não paga a carga na entrada; o adicional vai com a saída (art. 12). */
      importedAt4Deferred: boolean;
      exits: NetLoadExitTable[];
    };

/** Retenção da indústria nas saídas internas (art. 2º), na redação atual. */
export interface NetLoadIndustryRule {
  /** `fixed`: carga do próprio artigo; `annex-iii`: "a carga líquida de que trata o Anexo III". */
  kind: 'fixed' | 'annex-iii';
  article: string;
  validFrom: string | null;
  load: string | null;
  /** Produto fora do ato do Secretário (informática, art. 2º, § 4º). */
  unlistedLoad: string | null;
  mva: string;
  /** Carga do ICMS do produto acima da qual (ou abaixo) há "ajuste proporcional" (art. 2º-B). */
  referenceRate: string | null;
  /** Carga própria e opcional para algumas CNAE (construção, art. 2º-A). */
  optional: { article: string; cnaes: string[]; load: string } | null;
  /** Não se aplica à indústria do Simples Nacional (construção, art. 2º, § 2º, II). */
  simplesExcluded: boolean;
  /** A margem "não se aplica quando o contribuinte do imposto for o estabelecimento matriz". */
  headOfficeWithoutMva: boolean;
}

/** Lista dos produtos de informática do ato do Secretário da Fazenda (IN SEFAZ 148/2024). */
export interface InformaticsList {
  act: string;
  decree: string;
  sources: string[];
  versions: {
    validFrom: string;
    validTo: string | null;
    amendedBy: string | null;
    items: { ncm: string[]; description: string; except: string[] }[];
  }[];
}

const table = data as {
  origins: NetLoadOrigin[];
  regimes: NetLoadRegime[];
  informaticsList: InformaticsList;
};

export const CE_INFORMATICS_LIST: Readonly<InformaticsList> = table.informaticsList;

/**
 * A NCM está na lista de produtos de informática do Ceará na data? `unknown` antes da IN 148/2024
 * (a IN 04/2013 não tem texto oficial consolidado no Bipaê). A posição ou subposição da lista
 * abrange todas as NCM abaixo dela (IN 148/2024, art. 2º), menos as exceções escritas no item.
 */
export function ceInformaticsListed(
  ncm: string | null | undefined,
  date: string,
):
  | { status: 'listed'; item: InformaticsList['versions'][number]['items'][number] }
  | { status: 'not-listed' }
  | { status: 'unknown' } {
  const version = CE_INFORMATICS_LIST.versions.find(
    (v) => date >= v.validFrom && (v.validTo === null || date <= v.validTo),
  );
  const code = (ncm ?? '').replace(/\D/g, '');
  if (!version || code.length !== 8) return { status: 'unknown' };
  const digits = (n: string) => n.replace(/\D/g, '');
  const item = version.items.find(
    (i) =>
      i.ncm.some((n) => code.startsWith(digits(n))) &&
      !i.except.some((n) => code.startsWith(digits(n))),
  );
  return item ? { status: 'listed', item } : { status: 'not-listed' };
}

export const ST_NET_LOAD_ORIGINS: readonly NetLoadOrigin[] = table.origins;
export const ST_NET_LOAD_REGIMES: readonly NetLoadRegime[] = table.regimes;

/** UFs que já têm regimes de carga líquida no Bipaê. */
export const ST_NET_LOAD_UFS: readonly string[] = [
  ...new Set(ST_NET_LOAD_REGIMES.map((r) => r.uf)),
];

/**
 * A coluna de origem pela UF do remetente ("EX" para a importação direta). As colunas são as das
 * tabelas do Ceará, a única UF com carga líquida no Bipaê por enquanto.
 */
export function netLoadOriginOf(originUf: string): NetLoadOrigin | null {
  const uf = originUf.toUpperCase();
  if (uf === 'EX') return ST_NET_LOAD_ORIGINS.find((o) => o.abroad) ?? null;
  return ST_NET_LOAD_ORIGINS.find((o) => o.ufs.includes(uf)) ?? null;
}

/** A tabela do regime que vale na data. */
export function netLoadVersionOn(regime: NetLoadRegime, date: string): NetLoadVersion | null {
  return (
    regime.versions.find((v) => date >= v.validFrom && (v.validTo === null || date <= v.validTo)) ??
    null
  );
}

const coversCest = (regime: NetLoadRegime, cest: string | null | undefined) =>
  regime.cestSegments === null ||
  (!!cest && regime.cestSegments.some((s) => cest.replace(/\D/g, '').startsWith(s)));

/**
 * Regimes da UF com tabela na data que podem alcançar o produto: os que valem para as mercadorias
 * do estabelecimento e os de segmento do CEST quando um dos CEST do produto é do segmento.
 */
export function stNetLoadRegimesFor(
  uf: string,
  date: string,
  cests: readonly string[] = [],
): { regime: NetLoadRegime; version: NetLoadVersion }[] {
  return ST_NET_LOAD_REGIMES.filter((r) => r.uf === uf.toUpperCase())
    .filter((r) => r.cestSegments === null || cests.some((c) => coversCest(r, c)))
    .flatMap((regime) => {
      const version = netLoadVersionOn(regime, date);
      return version ? [{ regime, version }] : [];
    });
}

export interface StNetLoadInput {
  /** UF do comprador (onde o regime vale). */
  uf: string;
  /** CNAE-Fiscal principal do comprador (7 dígitos, com ou sem máscara). */
  buyerCnae: string;
  /** UF do remetente, ou "EX" para a importação direta do exterior. */
  originUf: string;
  date: string;
  /**
   * Classe da mercadoria na tabela, escolhida pela empresa no produto (D-042). `outside` diz que a
   * empresa confirmou que o produto está fora do regime (exclusões do decreto).
   */
  goodsClass?: string | null;
  cest?: string | null;
  /** O fornecedor é do Simples Nacional (acréscimo do decreto). */
  supplierSimples?: boolean;
  /** Importado a 4% (Resolução do Senado 13/2012) vindo de outra UF. */
  importedAt4?: boolean;
  /** O comprador é optante pelo Simples Nacional (regra própria em alguns decretos). */
  buyerSimples?: boolean;
  /** Entrada em transferência entre estabelecimentos do mesmo titular (margem própria). */
  transfer?: boolean;
  /** O comprador tem Regime Especial de Tributação (RET) com a SEFAZ (cargas próprias). */
  specialRegime?: boolean;
  /** NCM do produto: confere a classe "produtos de informática" com a lista do ato do Secretário. */
  ncm?: string | null;
}

/** Classe que a empresa escolhe quando o produto está fora do regime de carga líquida. */
export const NET_LOAD_OUTSIDE = 'outside';

/** A classe existe em alguma tabela de carga líquida (ou é "fora do regime")? */
export function isNetLoadGoodsClass(goodsClass: string): boolean {
  return (
    goodsClass === NET_LOAD_OUTSIDE ||
    ST_NET_LOAD_REGIMES.some((r) =>
      r.versions.some((v) => v.loads.some((l) => l.goodsClass === goodsClass)),
    )
  );
}

/** O que ainda não é calculado pelo Bipaê: volta como "falta configurar", com o motivo. */
export type NetLoadMissingTopic = 'transfer' | 'special-regime';

export type StNetLoadResult =
  | {
      status: 'applies';
      regime: NetLoadRegime;
      version: NetLoadVersion;
      buyer: NetLoadBuyer;
      origin: NetLoadOrigin;
      row: NetLoadRow;
      /** Carga da tabela, em percentual. */
      loadPercent: string;
      additions: { kind: 'simples' | 'import4'; percent: string }[];
      /** Carga da tabela mais os acréscimos. */
      totalPercent: string;
      mva: string | null;
      warnings: string[];
    }
  | { status: 'not-listed' }
  | { status: 'ambiguous'; regimes: NetLoadRegime[] }
  | { status: 'industry'; regime: NetLoadRegime; buyer: NetLoadBuyer }
  | { status: 'product-out'; regime: NetLoadRegime }
  | { status: 'simples-excluded'; regime: NetLoadRegime }
  | { status: 'missing'; regime: NetLoadRegime; topic: NetLoadMissingTopic; message: string }
  /** Nada a pagar na entrada: o imposto vai junto com a saída (RET dos farmacêuticos, art. 12). */
  | { status: 'deferred'; regime: NetLoadRegime; message: string }
  | { status: 'no-table'; regime: NetLoadRegime }
  | { status: 'unknown-origin'; regime: NetLoadRegime }
  | {
      status: 'choose-class';
      regime: NetLoadRegime;
      classes: { goodsClass: string; label: string }[];
    };

const sum = (values: string[]) => values.reduce((acc, v) => acc.plus(dec(v)), dec(0)).toString();

/**
 * A carga líquida que vale para o comprador, a origem e a classe da mercadoria na data. Nada é
 * suposto: CNAE fora dos anexos, CNAE em mais de um decreto, produto fora do segmento e classe
 * da mercadoria não escolhida voltam como situação, para a empresa configurar.
 */
export function stNetLoadFor(input: StNetLoadInput): StNetLoadResult {
  const cnae = input.buyerCnae.replace(/\D/g, '');
  const listed = ST_NET_LOAD_REGIMES.filter((r) => r.uf === input.uf.toUpperCase()).flatMap(
    (regime) =>
      regime.buyers
        .filter((b) => b.cnae === cnae && (b.validFrom === null || input.date >= b.validFrom))
        .map((buyer) => ({ regime, buyer })),
  );
  if (listed.length === 0) return { status: 'not-listed' };
  if (listed.length > 1) return { status: 'ambiguous', regimes: listed.map((l) => l.regime) };
  const { regime, buyer } = listed[0]!;
  if (buyer.group === 'industry') return { status: 'industry', regime, buyer };
  if (input.goodsClass === NET_LOAD_OUTSIDE || !coversCest(regime, input.cest))
    return { status: 'product-out', regime };
  const simplesRule = input.buyerSimples ? regime.simplesBuyer : null;
  if (simplesRule?.rule === 'excluded') return { status: 'simples-excluded', regime };
  const warnings: string[] = [];
  const missing = (topic: NetLoadMissingTopic, message: string): StNetLoadResult => ({
    status: 'missing',
    regime,
    topic,
    message,
  });
  const interstate = input.originUf.toUpperCase() !== input.uf.toUpperCase();
  // Regime Especial de Tributação (RET), F3-26.d.CE.d: o que cada decreto diz dele.
  const ret = input.specialRegime ? regime.specialRegime : null;
  if (input.specialRegime && !ret) {
    return missing(
      'special-regime',
      `Falta configurar: o ${regime.act} não traz carga própria para o Regime Especial de Tributação (RET); a carga vem do termo do regime.`,
    );
  }
  if (ret?.kind === 'own-table') return specialRegimeEntry(input, regime, buyer, ret, interstate);
  if (ret && buyer.group !== 'wholesale') {
    warnings.push(
      `O RET do ${regime.act} (${ret.article}) é do atacadista do Anexo I: vale a carga do comprador.`,
    );
  } else if (ret) {
    warnings.push(
      `Regime especial (${ret.article} do ${regime.act}): carga do Anexo III${ret.adjustable ? ', que o termo do RET pode ajustar até a carga tributária efetiva' : ''}. O termo diz se o recolhimento é na entrada, na saída ou misto (Lei 14.237/2008, art. 4º): confira.`,
    );
  }
  // Transferência: a margem do parágrafo próprio de cada decreto (D-042).
  let transferMva: string | null = null;
  if (input.transfer) {
    const rule = regime.transfer;
    const mva = interstate ? rule.interstateMva : rule.internalMva;
    if (mva === null) {
      warnings.push(
        `Transferência interna: o ${regime.act} só dá margem própria para a transferência vinda de outra UF; vale a margem do cálculo comum.`,
      );
    } else if (rule.basis === 'caput' && regime.mva !== null) {
      return missing(
        'transfer',
        `Falta configurar: na transferência, o ${regime.act} manda usar "a base definida no caput, acrescida de ${mva.replace('.', ',')}%", e o caput já tem margem de ${regime.mva.replace('.', ',')}%. Não está claro se a margem passa a ser ${mva.replace('.', ',')}% ou se as duas se somam (dúvida D-042).`,
      );
    } else {
      transferMva = mva;
      warnings.push(`Transferência: margem de ${mva.replace('.', ',')}% (${regime.act}).`);
    }
  }
  const version = netLoadVersionOn(regime, input.date);
  if (!version) return { status: 'no-table', regime };
  const origin = netLoadOriginOf(input.originUf);
  if (!origin) return { status: 'unknown-origin', regime };
  const rows = version.loads.filter((l) => l.group === buyer.group);
  const row = rows.find((l) => l.goodsClass === input.goodsClass);
  const loadPercent = row?.percents[origin.key];
  if (!row || loadPercent === undefined) {
    return {
      status: 'choose-class',
      regime,
      classes: rows.map((l) => ({ goodsClass: l.goodsClass, label: l.label })),
    };
  }
  warnings.push(...informaticsWarnings(input, version));
  const additions: { kind: 'simples' | 'import4'; percent: string }[] = [];
  if (input.supplierSimples) {
    const extra = regime.simplesAddition?.[origin.key];
    if (extra) additions.push({ kind: 'simples', percent: extra });
    else warnings.push(`O ${regime.act} não traz acréscimo para fornecedor do Simples Nacional.`);
  }
  if (input.importedAt4) {
    const extra = regime.importAddition?.[origin.key];
    if (extra) additions.push({ kind: 'import4', percent: extra });
    else warnings.push(`O ${regime.act} não traz acréscimo para o importado a 4% desta origem.`);
  }
  const simplesMva = simplesRule?.rule === 'mva' ? simplesRule.mva : null;
  if (simplesMva && !transferMva) {
    warnings.push(`Comprador do Simples Nacional: margem de ${simplesMva}% (${regime.act}).`);
  }
  return {
    status: 'applies',
    regime,
    version,
    buyer,
    origin,
    row,
    loadPercent,
    additions,
    totalPercent:
      additions.length === 0 ? loadPercent : sum([loadPercent, ...additions.map((a) => a.percent)]),
    mva: transferMva ?? simplesMva ?? regime.mva,
    warnings,
  };
}

/**
 * Aviso quando a classe "produtos de informática" não bate com a lista do ato do Secretário (IN
 * SEFAZ 148/2024): a classe continua escolha da empresa, a lista só confere.
 */
function informaticsWarnings(input: StNetLoadInput, version: NetLoadVersion): string[] {
  if (!input.ncm || !version.loads.some((l) => l.goodsClass === 'informatics')) return [];
  const found = ceInformaticsListed(input.ncm, input.date);
  if (found.status === 'unknown') return [];
  const act = CE_INFORMATICS_LIST.act;
  if (input.goodsClass === 'informatics' && found.status === 'not-listed') {
    return [
      `A NCM ${input.ncm} não está na lista de produtos de informática (${act}): confira a classe do produto.`,
    ];
  }
  if (input.goodsClass !== 'informatics' && found.status === 'listed') {
    return [
      `A NCM ${input.ncm} está na lista de produtos de informática (${act}, "${found.item.description}"): confira a classe do produto.`,
    ];
  }
  return [];
}

/**
 * Entrada com o RET dos farmacêuticos (Decreto 36.617, arts. 6º, 11 e 12): carga própria sobre o
 * valor do documento, sem margem, pela origem; complemento do fornecedor do Simples; outra carga
 * na transferência. A entrada interna não tem coluna (entre atacadistas com RET fica diferida,
 * art. 11) e o importado a 4% não paga na entrada (art. 12).
 */
function specialRegimeEntry(
  input: StNetLoadInput,
  regime: NetLoadRegime,
  buyer: NetLoadBuyer,
  ret: Extract<NetLoadSpecialRegime, { kind: 'own-table' }>,
  interstate: boolean,
): StNetLoadResult {
  const version = netLoadVersionOn(regime, input.date);
  if (!version) return { status: 'no-table', regime };
  const origin = netLoadOriginOf(input.originUf);
  if (!origin) return { status: 'unknown-origin', regime };
  if (input.importedAt4 && interstate && ret.importedAt4Deferred) {
    return {
      status: 'deferred',
      regime,
      message: `RET (${regime.act}, art. 12): o importado a 4% não paga a carga na entrada; o adicional vai junto com a saída interna.`,
    };
  }
  const table = input.transfer ? ret.transfer : ret.entry;
  const loadPercent = table[origin.key];
  if (loadPercent === undefined) {
    return {
      status: 'missing',
      regime,
      topic: 'special-regime',
      message: `Falta configurar: com RET, a tabela de entrada do ${regime.act} (art. 6º) só tem as colunas de outras UFs.${ret.internalBetweenWholesalersDeferred ? ' Entre atacadistas com RET o ICMS fica diferido para a saída (art. 11).' : ''} Confira o termo do regime.`,
    };
  }
  const additions: { kind: 'simples' | 'import4'; percent: string }[] = [];
  const warnings: string[] = [];
  if (input.supplierSimples && !input.transfer) {
    const extra = ret.simplesAddition[origin.key];
    if (extra) additions.push({ kind: 'simples', percent: extra });
  }
  const cd = ret.distributionCenter[origin.key];
  if (cd && !input.transfer) {
    warnings.push(
      `Centro de distribuição que comprovou 50% de transferências no ano anterior (art. 7º): a carga é ${cd.replace('.', ',')}%, no lugar desta.`,
    );
  }
  warnings.push(
    `Regime especial (${ret.article} do ${regime.act}): base é o valor do documento, sem margem; o restante é retido na saída, pelo canal Farma ou Hospitalar.`,
  );
  const row: NetLoadRow = {
    group: buyer.group,
    goodsClass: input.goodsClass ?? '',
    label: input.transfer ? 'RET, transferência (art. 6º)' : 'RET, entrada (art. 6º)',
    percents: table,
  };
  return {
    status: 'applies',
    regime,
    version,
    buyer,
    origin,
    row,
    loadPercent,
    additions,
    totalPercent:
      additions.length === 0 ? loadPercent : sum([loadPercent, ...additions.map((a) => a.percent)]),
    mva: null,
    warnings,
  };
}

/** Em palavras, para a compra e a nota: o que a situação da carga líquida quer dizer. */
export function stNetLoadMessage(result: StNetLoadResult): string {
  switch (result.status) {
    case 'applies':
      return `Carga líquida de ${result.totalPercent.replace('.', ',')}% (${result.regime.act}, ${result.row.label}).`;
    case 'not-listed':
      return 'A CNAE principal da empresa não está nos decretos de carga líquida: vale a ST comum.';
    case 'ambiguous':
      return `A CNAE principal está em mais de um decreto (${result.regimes.map((r) => r.act).join(', ')}): confira com o contador.`;
    case 'industry':
      return `Indústria no ${result.regime.act}: sem carga líquida na entrada; a retenção nas saídas internas (art. 2º) aparece na nota de venda.`;
    case 'product-out':
      return `Produto fora do ${result.regime.act}.`;
    case 'simples-excluded':
      return `O ${result.regime.act} não se aplica a empresas do Simples Nacional.`;
    case 'missing':
    case 'deferred':
      return result.message;
    case 'no-table':
      return `O Bipaê não tem a tabela do ${result.regime.act} nesta data.`;
    case 'unknown-origin':
      return `Origem do fornecedor fora das colunas do ${result.regime.act}.`;
    case 'choose-class':
      return `Falta configurar: escolha no produto a classe da mercadoria do ${result.regime.act} (ou "fora do regime").`;
  }
}

/**
 * Na saída interna de mercadoria cuja ST foi recolhida na entrada pela carga líquida, a nota leva a
 * expressão do decreto (art. 7º, § 1º, ou o equivalente: "Nas operações internas"). Devolve a
 * expressão quando o vendedor é comprador do regime e o produto está nele; null nos outros casos.
 */
export function stNetLoadOutputNote(input: {
  uf: string;
  sellerCnae: string | null | undefined;
  destinationUf: string;
  date: string;
  goodsClass: string | null | undefined;
  cest?: string | null;
  sellerSimples?: boolean;
}): { regime: NetLoadRegime; note: string } | null {
  if (!input.sellerCnae || !input.goodsClass) return null;
  if (input.destinationUf.toUpperCase() !== input.uf.toUpperCase()) return null;
  const result = stNetLoadFor({
    uf: input.uf,
    buyerCnae: input.sellerCnae,
    originUf: input.uf,
    date: input.date,
    goodsClass: input.goodsClass,
    cest: input.cest ?? null,
    buyerSimples: input.sellerSimples ?? false,
  });
  // A classe da tabela não muda a expressão: basta o produto estar no regime do comprador.
  if (result.status !== 'applies' && result.status !== 'choose-class') return null;
  return { regime: result.regime, note: result.regime.outputNote };
}

/**
 * Base e valor da ST por carga líquida: valor da nota de entrada (com IPI, frete, seguro e
 * encargos) acrescido da margem, quando houver, vezes a carga. Centavos inteiros na entrada e na
 * saída, decimal no meio e arredondamento explícito.
 */
export function stNetLoadAmount(input: {
  documentCents: number;
  mva: string | null;
  loadPercent: string;
  rounding?: RoundingMode;
}): { baseCents: number; stCents: number } {
  const rounding = input.rounding ?? 'half-up';
  const base = fromCents(input.documentCents).mul(dec(1).plus(percent(input.mva ?? '0')));
  const baseCents = toCents(base, rounding);
  const stCents = toCents(fromCents(baseCents).mul(percent(input.loadPercent)), rounding);
  return { baseCents, stCents };
}

/** Uma forma de reter na saída: o artigo, a carga, a margem e os valores do item. */
export interface NetLoadExitOption {
  label: string;
  loadPercent: string;
  mva: string | null;
  baseCents: number;
  stCents: number;
}

export type StNetLoadExitResult =
  /** A indústria retém pelo art. 2º (informática e construção). */
  | { status: 'retains'; regime: NetLoadRegime; option: NetLoadExitOption; warnings: string[] }
  /** RET dos farmacêuticos: a carga depende do canal, que sai do destino da venda. */
  | { status: 'channels'; regime: NetLoadRegime; options: NetLoadExitOption[]; warnings: string[] }
  | { status: 'missing'; regime: NetLoadRegime; message: string };

const pctText = (value: string) => `${value.replace('.', ',')}%`;

/**
 * Retenção na saída interna pela carga líquida (F3-26.d.CE.d), só cálculo e texto, nunca impede a
 * nota:
 * - indústria do Anexo I (art. 2º): carga do artigo sobre o valor da operação mais a margem;
 *   na informática, a carga do § 4º quando a NCM não está no ato do Secretário; na construção, só
 *   a carga do art. 2º-B (20%) tem regra completa; em móveis o texto não diz a linha do Anexo III;
 * - atacadista de farmacêuticos com RET (arts. 8º a 10): a carga de cada canal sobre o valor da
 *   saída, sem margem.
 * Null quando nada é retido (saída interestadual, vendedor fora dos decretos, produto fora).
 */
export function stNetLoadExit(input: {
  uf: string;
  sellerCnae: string | null | undefined;
  sellerSimples?: boolean;
  specialRegime?: boolean;
  destinationUf: string;
  date: string;
  goodsClass: string | null | undefined;
  cest?: string | null;
  ncm?: string | null;
  /** Valor da operação do item (produto menos desconto mais frete), em centavos. */
  operationCents: number;
  transfer?: boolean;
}): StNetLoadExitResult | null {
  const cnae = (input.sellerCnae ?? '').replace(/\D/g, '');
  if (!cnae || input.destinationUf.toUpperCase() !== input.uf.toUpperCase()) return null;
  if (input.goodsClass === NET_LOAD_OUTSIDE) return null;
  const listed = ST_NET_LOAD_REGIMES.filter((r) => r.uf === input.uf.toUpperCase()).flatMap(
    (regime) =>
      regime.buyers
        .filter((b) => b.cnae === cnae && (b.validFrom === null || input.date >= b.validFrom))
        .map((buyer) => ({ regime, buyer })),
  );
  if (listed.length !== 1) return null;
  const { regime, buyer } = listed[0]!;
  if (!coversCest(regime, input.cest)) return null;
  const missing = (message: string): StNetLoadExitResult => ({
    status: 'missing',
    regime,
    message,
  });
  const option = (label: string, loadPercent: string, mva: string | null): NetLoadExitOption => ({
    label,
    loadPercent,
    mva,
    ...stNetLoadAmount({ documentCents: input.operationCents, mva, loadPercent }),
  });

  if (buyer.group === 'industry') {
    const rule = regime.industry;
    if (!rule) return null;
    if (rule.simplesExcluded && input.sellerSimples) return null;
    if (rule.validFrom === null || input.date < rule.validFrom) {
      return missing(`O Bipaê não tem a redação do ${rule.article} do ${regime.act} nesta data.`);
    }
    if (rule.kind === 'annex-iii' || rule.load === null) {
      return missing(
        `Falta configurar: o ${rule.article} do ${regime.act} manda a indústria reter "a carga líquida de que trata o Anexo III" com margem de ${pctText(rule.mva)}, sem dizer a linha da tabela (atacadista ou varejista) nem a origem (dúvida D-042).`,
      );
    }
    if (rule.optional?.cnaes.includes(cnae)) {
      return missing(
        `Falta configurar: a CNAE ${cnae} pode reter pelo ${rule.optional.article} (${pctText(rule.optional.load)}) no lugar do ${rule.article} (${pctText(rule.load)}) do ${regime.act}; a escolha é da empresa, com o contador (dúvida D-042).`,
      );
    }
    if (rule.referenceRate !== null && input.goodsClass !== `rate-${rule.referenceRate}`) {
      if (!input.goodsClass) {
        return missing(
          `Falta configurar: escolha no produto a classe da mercadoria do ${regime.act} (a carga do ${rule.article} é para o produto de ${rule.referenceRate}%).`,
        );
      }
      return missing(
        `Falta configurar: o ${regime.act} manda o "ajuste proporcional" da carga quando o ICMS do produto não é ${rule.referenceRate}% (art. 2º-B), sem dizer a conta (dúvida D-042).`,
      );
    }
    const warnings = [
      `Recolha em DAE específico (${rule.article}, § 1º). A nota ainda não leva esse valor nos campos da ST (dúvida D-042).`,
      `Não vale na venda ao atacadista com RET que recolhe o imposto (${rule.article}, § 2º).`,
    ];
    if (rule.headOfficeWithoutMva) {
      warnings.push(
        `O ${rule.article}, § 3º, tira a margem "quando o contribuinte do imposto for o estabelecimento matriz": confira com o contador.`,
      );
    }
    let load = rule.load;
    let label = `${rule.article} do ${regime.act}`;
    if (rule.unlistedLoad !== null) {
      const found = ceInformaticsListed(input.ncm, input.date);
      const inList =
        found.status === 'unknown' ? input.goodsClass === 'informatics' : found.status === 'listed';
      if (!inList) {
        load = rule.unlistedLoad;
        label = `${rule.article}, § 4º, do ${regime.act} (produto fora do ato do Secretário)`;
      }
      if (found.status === 'unknown') {
        warnings.push(
          `Sem a NCM na lista oficial desta data: o Bipaê usou a classe do produto para saber se ele está no ato do Secretário.`,
        );
      }
    }
    return { status: 'retains', regime, option: option(label, load, rule.mva), warnings };
  }

  const ret = input.specialRegime ? regime.specialRegime : null;
  if (ret?.kind !== 'own-table') return null;
  const tables = ret.exits.filter((t) => input.date >= t.validFrom);
  if (tables.length === 0) {
    return missing(`O Bipaê não tem as tabelas de saída do RET do ${regime.act} nesta data.`);
  }
  const names: Record<NetLoadExitTable['channel'], string> = {
    hospital: 'Canal Hospitalar (art. 8º)',
    pharma: 'Canal Farma (art. 9º)',
    'distribution-center': 'Centro de distribuição para as filiais (art. 10)',
  };
  const options: NetLoadExitOption[] = [];
  for (const t of tables) {
    const rows = input.transfer ? (t.transfer ?? t.sale) : t.sale;
    const row = rows.find((r) => r.goodsClass === input.goodsClass);
    if (!row) {
      return missing(
        `Falta configurar: escolha no produto a classe da mercadoria (${rows.map((r) => r.label).join(', ')}) para a saída do RET do ${regime.act}.`,
      );
    }
    options.push(
      option(`${names[t.channel]}${input.transfer ? ', transferência' : ''}`, row.percent, null),
    );
  }
  return {
    status: 'channels',
    regime,
    options,
    warnings: [
      `O canal sai do destino da venda (art. 4º, § 2º): hospitais, clínicas, casas de saúde e órgãos públicos no Hospitalar; os outros no Farma; a pessoa física deste Estado no Farma (§ 4º-A). A nota ainda não leva esse valor nos campos da ST (dúvida D-042).`,
    ],
  };
}

/** O resultado da retenção na saída em uma frase, para as observações da nota. */
export function stNetLoadExitMessage(result: StNetLoadExitResult): string {
  const money = (cents: number) =>
    `R$ ${(cents / 100)
      .toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d),)/g, '.')}`;
  const line = (o: NetLoadExitOption) =>
    `${o.label}: base ${money(o.baseCents)}${o.mva ? ` (com margem de ${pctText(o.mva)})` : ''}, carga ${pctText(o.loadPercent)}, ICMS retido ${money(o.stCents)}`;
  switch (result.status) {
    case 'retains':
      return `Retenção na saída interna, ${line(result.option)}. ${result.warnings.join(' ')}`;
    case 'channels':
      return `Retenção na saída do RET: ${result.options.map(line).join('; ')}. ${result.warnings.join(' ')}`;
    case 'missing':
      return result.message;
  }
}
