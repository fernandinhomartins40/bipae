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
  /** Da redação atual para as anteriores. */
  versions: NetLoadVersion[];
}

const table = data as { origins: NetLoadOrigin[]; regimes: NetLoadRegime[] };

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
  // RET e transferência têm cargas e margens próprias que o Bipaê ainda não lê (D-042).
  if (input.specialRegime) {
    return {
      status: 'missing',
      regime,
      topic: 'special-regime',
      message: `Falta configurar: com Regime Especial de Tributação (RET), a carga do ${regime.act} vem do termo do regime, que o Bipaê ainda não calcula.`,
    };
  }
  if (input.transfer) {
    return {
      status: 'missing',
      regime,
      topic: 'transfer',
      message: `Falta configurar: a transferência entre estabelecimentos tem margem própria no ${regime.act}, que o Bipaê ainda não calcula.`,
    };
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
  const warnings: string[] = [];
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
  if (simplesMva) {
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
    mva: simplesMva ?? regime.mva,
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
      return `Indústria no ${result.regime.act}: sem carga líquida na entrada. A retenção nas saídas internas (art. 2º) ainda falta configurar.`;
    case 'product-out':
      return `Produto fora do ${result.regime.act}.`;
    case 'simples-excluded':
      return `O ${result.regime.act} não se aplica a empresas do Simples Nacional.`;
    case 'missing':
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
