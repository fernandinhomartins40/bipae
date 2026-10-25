import data from './data/st-net-loads.json';
import { NET_LOAD_OUTSIDE, stNetLoadAmount, type StNetLoadOptions } from './st-net-loads';

/**
 * Carga fixa "por produto" (F3-26.d.MA.d): no Maranhão, as carnes e o gado bovino e bubalino
 * (Anexo 4.4 do RICMS/MA) pagam a ST como uma carga fixa sobre a base (valor da operação com seguro
 * e encargos mais a margem de 25%), e não pela alíquota interna menos o crédito. Ao contrário da
 * carga líquida do Ceará, o regime não depende da CNAE: vale para qualquer adquirente do Estado
 * (art. 1º). O anexo não traz NCM nem CEST, então a classe do produto é escolha da empresa, e o
 * credenciamento do frigorífico (Portaria 178/2025-GABIN) é configuração dela (dúvida D-045).
 *
 * Tudo vem de `st-net-loads.json` (`productRegimes`), gerado dos PDFs oficiais em sources/. O
 * cálculo é só cálculo: nunca impede a compra nem a nota.
 */

export interface ProductLoadVersion {
  validFrom: string;
  validTo: string | null;
  amendedBy: string | null;
  /** Art. 6º, I: entrada interestadual, em percentual. */
  interstateEntry: string;
  /** Art. 6º, II: saída interestadual do frigorífico credenciado. */
  interstateExitAccredited: string;
  /** Art. 6º, III: operações internas (credenciamento do § 7º). */
  internalAccredited: string;
}

export interface ProductLoadRegime {
  uf: string;
  id: string;
  act: string;
  source: string;
  url: string;
  segmentName: string;
  /** Margem do art. 5º, em percentual. */
  mva: string;
  /** Classes que a empresa escolhe no produto: gado (`ma-cattle`) e produtos da matança (`ma-meat`). */
  classes: { goodsClass: string; label: string }[];
  /**
   * NCM (prefixos) em que a compra pede a classe quando o produto não tem: os dos CEST de carne de
   * gado do Convênio ICMS 142/18 e os bovinos vivos. Só para perguntar; não decide nada.
   */
  askNcm: string[];
  /** Expressão da nota na saída interna seguinte e na transferência interna (art. 6º, §§ 1º e 2º). */
  outputNote: string;
  /** Ato do credenciamento dos incisos II e III (§§ 6º e 7º). */
  accreditation: { act: string; source: string; url: string; validFrom: string };
  versions: ProductLoadVersion[];
}

export const ST_PRODUCT_LOAD_REGIMES: readonly ProductLoadRegime[] = (
  data as unknown as { productRegimes: ProductLoadRegime[] }
).productRegimes;

/** Classe do gado bovino ou bubalino (Anexo 4.4 do RICMS/MA). */
export const MA_CATTLE = 'ma-cattle';
/** Classe dos produtos comestíveis da matança. */
export const MA_MEAT = 'ma-meat';

/** O regime por produto da UF, quando ela tem um. */
export function stProductLoadRegimeOf(uf: string | null | undefined): ProductLoadRegime | null {
  const code = (uf ?? '').toUpperCase();
  return ST_PRODUCT_LOAD_REGIMES.find((r) => r.uf === code) ?? null;
}

/** A redação do anexo que vale na data. */
export function productLoadVersionOn(
  regime: ProductLoadRegime,
  date: string,
): ProductLoadVersion | null {
  return (
    regime.versions.find((v) => date >= v.validFrom && (v.validTo === null || date <= v.validTo)) ??
    null
  );
}

const pctText = (value: string) => `${value.replace('.', ',')}%`;
const digits = (text: string | null | undefined) => (text ?? '').replace(/\D/g, '');

/** O NCM (ou o CEST de carne do Convênio) lembra o anexo? Só para pedir a classe. */
function asksClass(regime: ProductLoadRegime, ncm: string | null | undefined): boolean {
  const code = digits(ncm);
  return code.length >= 4 && regime.askNcm.some((prefix) => code.startsWith(prefix));
}

export interface StProductLoadInput {
  /** UF da empresa compradora. */
  uf: string;
  /** UF do remetente, ou "EX" para a importação direta. */
  originUf: string;
  date: string;
  /** Classe do produto escolhida pela empresa (`ma-cattle`, `ma-meat` ou `outside`). */
  goodsClass?: string | null;
  ncm?: string | null;
  /** A nota tem frete ou IPI no item (o art. 5º não os cita; D-051). */
  hasFreightOrIpi?: boolean;
  options?: StNetLoadOptions | null;
}

export type StProductLoadResult =
  | {
      status: 'applies';
      regime: ProductLoadRegime;
      version: ProductLoadVersion;
      goodsClass: string;
      label: string;
      loadPercent: string;
      mva: string;
      /** Frete e IPI entram na base (escolha da empresa); false quando não há ou ficam de fora. */
      includeCharges: boolean;
      warnings: string[];
    }
  | { status: 'not-listed' }
  | { status: 'product-out'; regime: ProductLoadRegime }
  | { status: 'choose-class'; regime: ProductLoadRegime; classes: ProductLoadRegime['classes'] }
  | { status: 'no-table'; regime: ProductLoadRegime }
  | { status: 'missing'; regime: ProductLoadRegime; message: string }
  /** O imposto fica diferido (gado para frigorífico regular, art. 3º). */
  | { status: 'deferred'; regime: ProductLoadRegime; message: string }
  /** Quem retém é o remetente do próprio Estado (art. 2º). */
  | { status: 'supplier-responsible'; regime: ProductLoadRegime; message: string };

/**
 * ST de entrada das carnes do Maranhão na compra: a carga do art. 6º, I, na entrada interestadual
 * (art. 1º, o adquirente retém); na compra interna, a retenção é do remetente (art. 2º); gado para
 * frigorífico regular fica diferido (art. 3º). Sem classe, sem a situação do frigorífico ou sem a
 * escolha do frete, volta "falta configurar".
 */
export function stProductLoadFor(input: StProductLoadInput): StProductLoadResult {
  const regime = stProductLoadRegimeOf(input.uf);
  if (!regime) return { status: 'not-listed' };
  if (input.goodsClass === NET_LOAD_OUTSIDE) return { status: 'product-out', regime };
  const chosen = regime.classes.find((c) => c.goodsClass === input.goodsClass);
  if (!chosen) {
    return asksClass(regime, input.ncm)
      ? { status: 'choose-class', regime, classes: regime.classes }
      : { status: 'not-listed' };
  }
  const version = productLoadVersionOn(regime, input.date);
  if (!version) return { status: 'no-table', regime };
  const missing = (message: string): StProductLoadResult => ({
    status: 'missing',
    regime,
    message,
  });
  const origin = input.originUf.toUpperCase();
  if (origin === 'EX') {
    return missing(
      `Falta configurar: o art. 6º do ${regime.act} não dá carga para a importação (o art. 7º, III, só diz que o imposto é recolhido no desembaraço). Confira com o contador.`,
    );
  }
  const cattle = chosen.goodsClass === MA_CATTLE;
  const plant = input.options?.meatPlant ?? null;
  if (cattle && plant === null) {
    return missing(
      `Falta configurar: o gado destinado a frigorífico regular e sob inspeção sanitária fica com o imposto diferido (art. 3º do ${regime.act}). Diga em Empresas e lojas se a empresa é frigorífico.`,
    );
  }
  if (cattle && plant !== 'none') {
    return {
      status: 'deferred',
      regime,
      message: `Gado para frigorífico regular e sob inspeção sanitária: lançamento e pagamento diferidos (art. 3º do ${regime.act}); o imposto sai com os produtos da matança (§ 1º).`,
    };
  }
  if (origin === input.uf.toUpperCase()) {
    return {
      status: 'supplier-responsible',
      regime,
      message: `Compra dentro do Maranhão: quem retém é o estabelecimento produtor (art. 2º do ${regime.act}), com ${pctText(version.internalAccredited)} sobre o valor mais ${pctText(regime.mva)} quando credenciado (art. 6º, III). A nota veio sem ICMS retido: confira com o fornecedor.`,
    };
  }
  const charges = input.options?.meatBaseCharges ?? null;
  if (input.hasFreightOrIpi && charges === null) {
    return missing(
      `Falta configurar: o art. 5º do ${regime.act} põe na base "seguro e outros encargos transferidos ao destinatário" e não cita frete nem IPI. Escolha em Empresas e lojas, com o contador, se eles entram na base (dúvida D-051).`,
    );
  }
  const warnings = [
    `A base não pode ser menor que o preço corrente na praça, e a SEFAZ-MA pode usar o preço de referência por quilo (art. 5º, parágrafo único).`,
    `Recolha na passagem pelo primeiro posto fiscal (art. 7º, II), ou até o dia 20 do mês seguinte se a empresa for credenciada (parágrafo único). Na saída seguinte não há complemento (art. 6º, § 4º).`,
  ];
  if (cattle) {
    warnings.push(`Gado para matadouro público: a retenção é do remetente (art. 4º).`);
  }
  if (input.hasFreightOrIpi) {
    warnings.push(
      charges === 'include'
        ? 'Frete e IPI na base (escolha da empresa; dúvida D-051).'
        : 'Frete e IPI fora da base (escolha da empresa; dúvida D-051).',
    );
  }
  return {
    status: 'applies',
    regime,
    version,
    goodsClass: chosen.goodsClass,
    label: `${chosen.label}, entrada interestadual (art. 6º, I)`,
    loadPercent: version.interstateEntry,
    mva: regime.mva,
    includeCharges: input.hasFreightOrIpi === true && charges === 'include',
    warnings,
  };
}

/** Em palavras, para a compra: o que a situação quer dizer. */
export function stProductLoadMessage(result: StProductLoadResult): string {
  switch (result.status) {
    case 'applies':
      return `Carga de ${pctText(result.loadPercent)} sobre o valor mais ${pctText(result.mva)} (${result.regime.act}, ${result.label}).`;
    case 'not-listed':
      return 'Produto fora dos regimes de carga fixa da UF.';
    case 'product-out':
      return `Produto fora do ${result.regime.act}.`;
    case 'choose-class':
      return `Falta configurar: diga no produto se ele é gado ou produto da matança de gado bovino ou bubalino (${result.regime.act}), ou "fora do regime".`;
    case 'no-table':
      return `O Bipaê não tem a redação do ${result.regime.act} nesta data.`;
    case 'missing':
    case 'deferred':
    case 'supplier-responsible':
      return result.message;
  }
}

/**
 * Na saída interna para contribuinte do ICMS do Estado e na transferência interna, a nota da
 * mercadoria tributada pelo anexo leva a expressão do art. 6º, §§ 1º e 2º, sem destaque do ICMS.
 */
export function stProductLoadOutputNote(input: {
  uf: string;
  destinationUf: string;
  date: string;
  goodsClass: string | null | undefined;
  /** O destinatário é contribuinte do ICMS (indicador 1). */
  recipientContributor: boolean;
  transfer: boolean;
}): { regime: ProductLoadRegime; note: string } | null {
  const regime = stProductLoadRegimeOf(input.uf);
  if (!regime || !regime.classes.some((c) => c.goodsClass === input.goodsClass)) return null;
  if (input.destinationUf.toUpperCase() !== regime.uf) return null;
  if (!input.recipientContributor && !input.transfer) return null;
  if (!productLoadVersionOn(regime, input.date)) return null;
  return { regime, note: regime.outputNote };
}

export type StProductLoadExitResult =
  | {
      status: 'retains';
      regime: ProductLoadRegime;
      label: string;
      loadPercent: string;
      mva: string;
      baseCents: number;
      stCents: number;
      warnings: string[];
    }
  | { status: 'missing'; regime: ProductLoadRegime; message: string };

/**
 * Retenção na saída do frigorífico (art. 2º): 0,75% nas operações internas (art. 6º, III) e 1% na
 * saída interestadual (art. 6º, II), sobre o valor da operação mais a margem, só com o
 * credenciamento da Portaria 178/2025-GABIN. Só para os produtos da matança e quem disse que é
 * frigorífico; null nos outros casos. Só cálculo e texto: nunca impede a nota.
 */
export function stProductLoadExit(input: {
  uf: string;
  destinationUf: string;
  date: string;
  goodsClass: string | null | undefined;
  /** Valor da operação do item (produto menos desconto mais frete), em centavos. */
  operationCents: number;
  /** Parte do frete no valor da operação, em centavos. */
  freightCents?: number;
  options?: StNetLoadOptions | null;
}): StProductLoadExitResult | null {
  const regime = stProductLoadRegimeOf(input.uf);
  if (!regime || input.goodsClass !== MA_MEAT) return null;
  const plant = input.options?.meatPlant ?? null;
  if (plant === null || plant === 'none') return null;
  const missing = (message: string): StProductLoadExitResult => ({
    status: 'missing',
    regime,
    message,
  });
  const version = productLoadVersionOn(regime, input.date);
  if (!version) return missing(`O Bipaê não tem a redação do ${regime.act} nesta data.`);
  const internal = input.destinationUf.toUpperCase() === regime.uf;
  const article = internal ? 'art. 6º, III' : 'art. 6º, II';
  if (plant !== 'accredited' || input.date < regime.accreditation.validFrom) {
    return missing(
      `Falta configurar: a carga do ${article} do ${regime.act} é para o frigorífico credenciado (${regime.accreditation.act}), e o anexo não diz qual carga vale sem o credenciamento (dúvida D-052). Confira com o contador.`,
    );
  }
  const freight = input.freightCents ?? 0;
  const charges = input.options?.meatBaseCharges ?? null;
  if (freight > 0 && charges === null) {
    return missing(
      `Falta configurar: o art. 5º do ${regime.act} não cita o frete na base. Escolha em Empresas e lojas, com o contador, se ele entra (dúvida D-051).`,
    );
  }
  const loadPercent = internal ? version.internalAccredited : version.interstateExitAccredited;
  const documentCents = input.operationCents - (charges === 'exclude' ? freight : 0);
  const warnings = [
    `Fica nas observações: o anexo não diz como lançar a carga nos campos da ST da nota (dúvida D-052).`,
  ];
  if (!internal) warnings.push('Sem crédito das entradas interestaduais (art. 6º, II).');
  return {
    status: 'retains',
    regime,
    label: `${article} do ${regime.act} (frigorífico credenciado)`,
    loadPercent,
    mva: regime.mva,
    ...stNetLoadAmount({ documentCents, mva: regime.mva, loadPercent }),
    warnings,
  };
}

/** O resultado da retenção na saída em uma frase, para as observações da nota. */
export function stProductLoadExitMessage(result: StProductLoadExitResult): string {
  if (result.status === 'missing') return result.message;
  const money = (cents: number) =>
    `R$ ${(cents / 100)
      .toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d),)/g, '.')}`;
  return `Retenção na saída, ${result.label}: base ${money(result.baseCents)} (com margem de ${pctText(result.mva)}), carga ${pctText(result.loadPercent)}, ICMS retido ${money(result.stCents)}. ${result.warnings.join(' ')}`;
}
