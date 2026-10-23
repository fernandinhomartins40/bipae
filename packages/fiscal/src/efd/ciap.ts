import { dec, round } from '../decimal';
import { EfdError, type EfdItem } from './read';

/**
 * CIAP, o Controle de Crédito de ICMS do Ativo Permanente (F4-14.b.7, bloco G da EFD ICMS/IPI).
 *
 * Fontes:
 * - LC 87/1996, art. 20, § 5º (redação da LC 102/2000 e, no inciso III, da LC 120/2005), lida no
 *   Planalto: o crédito do bem do ativo é apropriado "à razão de um quarenta e oito avos por mês,
 *   devendo a primeira fração ser apropriada no mês em que ocorrer a entrada no estabelecimento"
 *   (I), multiplicado pela "relação entre o valor das operações de saídas e prestações tributadas
 *   e o total das operações de saídas e prestações do período, equiparando-se às tributadas [...]
 *   as saídas e prestações com destino ao exterior" (III); na alienação antes dos quatro anos não
 *   se credita "a fração que corresponderia ao restante do quadriênio" (V); ao fim do 48º mês o
 *   saldo é cancelado (VII);
 * - Guia Prático da EFD ICMS/IPI 3.2.2, registros 0300, 0305, 0500, 0600, G110, G125, G130,
 *   G140 e E111.
 *
 * Aqui ficam as regras como dados e a conta do mês; `build.ts` escreve os registros.
 */

/** Regras do cálculo, com o arredondamento explícito de cada passo. */
export const EFD_CIAP_RULES = {
  /** NR_PARC do 0300: a LC 87/1996 fala em 48; a UF pode definir outro número (Guia, 0300). */
  installments: 48,
  installmentsSource: 'LC 87/1996, art. 20, § 5º, I',
  /**
   * G125, campo 10, validação a: a parcela tem de ser "igual ou menor" que o crédito total
   * dividido pelo NR_PARC. Por isso a divisão trunca os centavos.
   */
  installmentRounding: 'truncate',
  /** G110, campo 08: oito casas decimais, truncadas (o índice nunca passa do valor exato). */
  indexPlaces: 8,
  indexRounding: 'truncate',
  /** G110, campo 09: SOM_PARC × IND_PER_SAI, em centavos, meio para cima. */
  appropriationRounding: 'half-up',
} as const;

/** Tipos de movimentação do G125 que o Bipaê gera (Guia, G125, campo 04). */
export const EFD_CIAP_MOVEMENTS = {
  /** Bem que entrou em mês anterior e ainda tem parcela (regra 1.1). */
  opening: 'SI',
  /** Bem que entrou no mês (regra 1.2). */
  entry: 'IM',
  /** Fim do período de apropriação, junto do SI da última parcela (regra 1.5). */
  end: 'BA',
} as const;

/**
 * Saídas do bem antes do fim das parcelas (Guia, G125, regra 1.6). A alienação ou transferência
 * (AT) pede o G130 da nota de saída, que o Bipaê ainda não liga ao bem.
 */
export const EFD_CIAP_DISPOSALS: Readonly<Record<string, { label: string; supported: boolean }>> = {
  AT: { label: 'alienação ou transferência', supported: false },
  PE: { label: 'perecimento, extravio ou deterioração', supported: true },
  OT: { label: 'outras saídas do imobilizado', supported: true },
};

/**
 * 0305, campo 02: quem não adota centro de custo informa, na atividade comercial ou de serviços,
 * "1" (área operacional) ou "2" (área administrativa). O 0600 traz o nome.
 */
export const EFD_CIAP_COST_CENTERS: Readonly<Record<string, string>> = {
  '1': 'Área operacional',
  '2': 'Área administrativa',
};
export const EFD_CIAP_DEFAULT_COST_CENTER = '1';

/** 0500, campo 03: o bem fica numa conta do ativo ("01"), analítica ("A"). */
export const EFD_CIAP_ACCOUNT = { nature: '01', kind: 'A' } as const;

/**
 * E111, campo 02 (Guia): 8 caracteres, a UF, o terceiro "0" (ICMS próprio) e o quarto "2"
 * (outros créditos). O código exato vem da tabela 5.1.1 da UF (dúvida D-041), configurado pela
 * empresa.
 */
export const EFD_CIAP_ADJUSTMENT_CODE = /^([A-Z]{2})02\d{4}$/;

/**
 * Como cada saída entra no índice de participação (LC 87/1996, art. 20, § 5º, II e III), pelos
 * dois últimos dígitos do CST do C190:
 * - taxed: saída tributada;
 * - untaxed: isenta, não tributada ou com suspensão;
 * - taxedWhenIcms: conta como tributada só a parte com ICMS destacado (51, diferimento parcial;
 *   90, outras);
 * - company: a empresa decide (60, ICMS cobrado antes por substituição tributária; dúvida D-041).
 * Saída com CFOP de exportação (iniciado por 7) conta como tributada (art. 20, § 5º, III).
 */
export type CiapOutputClass = 'taxed' | 'untaxed' | 'taxedWhenIcms' | 'company';
export const EFD_CIAP_OUTPUT_CST: Readonly<Record<string, CiapOutputClass>> = {
  '00': 'taxed',
  '10': 'taxed',
  '20': 'taxed',
  '70': 'taxed',
  '30': 'untaxed',
  '40': 'untaxed',
  '41': 'untaxed',
  '50': 'untaxed',
  '51': 'taxedWhenIcms',
  '90': 'taxedWhenIcms',
  '60': 'company',
};
export const EFD_CIAP_EXPORT_CFOP_PREFIX = '7';

/**
 * Crédito do bem pela nota de compra: o ICMS próprio só vem de fornecedor do regime normal (CST
 * de 2 dígitos); o do Simples não dá crédito ao ativo (LC 123/2006, art. 23, § 1º, só na
 * comercialização ou industrialização). O ICMS-ST do item vai no campo 06 do G125.
 */
export const EFD_CIAP_ITEM_CREDIT = {
  normalSupplier: { own: true, st: true },
  simplesSupplier: { own: false, st: true },
  source: 'LC 87/1996, art. 20, § 5º; LC 123/2006, art. 23',
} as const;

/** O ICMS de um bem, em centavos, como o G125 separa (campos 05 a 08). */
export interface CiapIcms {
  ownCents: number;
  stCents: number;
  /** ICMS do frete do CT-e (o frete da própria NF-e já está no ICMS da operação). */
  freightCents: number;
  /** Diferencial de alíquota pago na guia, na compra de outra UF. */
  difalCents: number;
}

/**
 * O crédito de um item de compra para o ativo. A empresa do Simples não se credita (LC 123/2006,
 * art. 23, caput): devolve tudo zero.
 */
export function fixedAssetCredit(item: EfdItem, declarantSimples: boolean): CiapIcms {
  const zero = { ownCents: 0, stCents: 0, freightCents: 0, difalCents: 0 };
  if (declarantSimples) return zero;
  const rule =
    item.supplierCst.length === 3
      ? EFD_CIAP_ITEM_CREDIT.simplesSupplier
      : EFD_CIAP_ITEM_CREDIT.normalSupplier;
  return {
    ...zero,
    ownCents: rule.own ? item.icmsCents : 0,
    stCents: rule.st ? item.stCents : 0,
  };
}

/** Um bem no controle do CIAP. */
export interface EfdFixedAsset {
  /** COD_IND_BEM: código individual, que não se repete nem se reaproveita (0300). */
  code: string;
  description: string;
  /** Data da entrada no estabelecimento (AAAA-MM-DD): a primeira parcela é deste mês. */
  enteredOn: string;
  /** NR_PARC; o padrão é 48. */
  installments?: number;
  icms: CiapIcms;
  /** 0305: centro de custo ("1" ou "2" sem centro de custo próprio) e função do bem. */
  costCenter?: string;
  usage?: string;
  /** Saída do bem antes do fim das parcelas. */
  disposal?: { on: string; type: string };
  /** A nota de compra e o item (G130 e G140, no mês da entrada). */
  source?: { accessKey: string; line: number };
}

/** O CIAP do arquivo: os bens e o que a empresa configurou. */
export interface EfdCiap {
  assets: EfdFixedAsset[];
  /** Conta contábil do ativo (0300, COD_CTA, e 0500). Sem ela o bloco G não é gerado. */
  account?: { code: string; name: string; level: number; since?: string };
  /** Código do ajuste do E111 (tabela 5.1.1 da UF). Sem ele o crédito não entra no E110. */
  adjustmentCode?: string;
  /** As saídas com CST 60 contam como tributadas no índice? Sem resposta, não contam (D-041). */
  stOutputsTaxed?: boolean | null;
  /** Na saída do bem, a parcela do próprio mês ainda é apropriada? (Guia, G125, regra 1.6.) */
  disposalMonthCredit?: boolean;
}

/** Uma linha do C190 das saídas, para o índice. */
export interface CiapOutput {
  cst: string;
  cfop: string;
  operationCents: number;
  icmsCents: number;
}

export interface CiapIndex {
  taxedCents: number;
  totalCents: number;
  /** IND_PER_SAI com 8 casas, como texto decimal. */
  index: string;
  /** Houve saída com CST 60 e a empresa ainda não disse como conta (D-041). */
  stUndecided: boolean;
}

/** Índice de participação das saídas tributadas e exportações no total das saídas do mês. */
export function ciapOutputIndex(outputs: CiapOutput[], stOutputsTaxed?: boolean | null): CiapIndex {
  let taxed = 0;
  let total = 0;
  let stUndecided = false;
  for (const o of outputs) {
    total += o.operationCents;
    if (o.cfop.startsWith(EFD_CIAP_EXPORT_CFOP_PREFIX)) {
      taxed += o.operationCents;
      continue;
    }
    const kind = EFD_CIAP_OUTPUT_CST[o.cst.slice(-2)] ?? 'untaxed';
    if (kind === 'company') {
      if (stOutputsTaxed === true) taxed += o.operationCents;
      if (stOutputsTaxed === undefined || stOutputsTaxed === null) stUndecided = true;
    } else if (kind === 'taxed' || (kind === 'taxedWhenIcms' && o.icmsCents > 0)) {
      taxed += o.operationCents;
    }
  }
  // Sem nenhuma saída no mês não há relação a aplicar: o índice fica zero e nada é apropriado.
  const index =
    total > 0
      ? round(dec(taxed).div(total), EFD_CIAP_RULES.indexPlaces, EFD_CIAP_RULES.indexRounding)
      : dec(0);
  return {
    taxedCents: taxed,
    totalCents: total,
    index: index.toFixed(EFD_CIAP_RULES.indexPlaces),
    stUndecided,
  };
}

/** Uma movimentação do G125 no mês. */
export interface CiapMovement {
  asset: EfdFixedAsset;
  type: string;
  date: string;
  /** Os campos 05 a 08 (valores do ICMS do bem) vão preenchidos. */
  withValues: boolean;
  installment?: number;
  parcelCents?: number;
}

export interface CiapPlan {
  movements: CiapMovement[];
  /** G110, campo 04: soma do ICMS dos bens com movimento SI. */
  openingCents: number;
  /** G110, campo 05: soma das parcelas (VL_PARC_PASS). */
  parcelsCents: number;
  index: CiapIndex;
  /** G110, campo 09: crédito do mês (SOM_PARC × IND_PER_SAI). */
  appropriationCents: number;
  /** A parcela de cada bem no mês, para o controle dos bens. */
  installments: { code: string; installment: number }[];
  /** Bens deixados de fora, com o motivo, em português. */
  skipped: string[];
}

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

export const ciapTotal = (icms: CiapIcms) =>
  icms.ownCents + icms.stCents + icms.freightCents + icms.difalCents;

/** Parcela do bem: total ÷ NR_PARC, truncada nos centavos (G125, campo 10, validação a). */
export const ciapParcel = (icms: CiapIcms, installments: number) =>
  round(dec(ciapTotal(icms)).div(installments), 0, EFD_CIAP_RULES.installmentRounding).toNumber();

/**
 * A conta do CIAP no mês (AAAA-MM): quais bens entram, com que parcela, e o crédito apropriado
 * pelo índice das saídas.
 */
export function planCiap(
  ciap: EfdCiap,
  month: string,
  start: string,
  end: string,
  outputs: CiapOutput[],
): CiapPlan {
  const movements: CiapMovement[] = [];
  const installments: CiapPlan['installments'] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  let opening = 0;
  let parcels = 0;
  const assets = [...ciap.assets].sort((a, b) => a.code.localeCompare(b.code));
  for (const asset of assets) {
    if (!asset.code || asset.code.length > 60) {
      throw new EfdError(`Código de bem inválido no CIAP: ${asset.code}.`);
    }
    if (seen.has(asset.code)) throw new EfdError(`Bem repetido no CIAP: ${asset.code}.`);
    seen.add(asset.code);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asset.enteredOn)) {
      throw new EfdError(`Data de entrada inválida no bem ${asset.code}.`);
    }
    if (asset.enteredOn > end) continue;
    const total = ciapTotal(asset.icms);
    for (const value of Object.values(asset.icms)) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new EfdError(`Valor de ICMS inválido no bem ${asset.code}.`);
      }
    }
    const count = asset.installments ?? EFD_CIAP_RULES.installments;
    if (!Number.isInteger(count) || count < 1 || count > 999) {
      throw new EfdError(`Número de parcelas inválido no bem ${asset.code}.`);
    }
    if (total === 0) {
      skipped.push(`O bem ${asset.description} não tem ICMS a creditar e ficou fora do CIAP.`);
      continue;
    }
    const disposal = asset.disposal;
    if (disposal && disposal.on < start) continue;
    const installment = monthIndex(month) - monthIndex(asset.enteredOn) + 1;
    if (installment > count) continue;
    const disposedNow = disposal && disposal.on <= end;
    if (disposedNow) {
      const rule = EFD_CIAP_DISPOSALS[disposal.type];
      if (!rule) throw new EfdError(`Tipo de saída do bem inválido: ${disposal.type}.`);
      if (!rule.supported) {
        throw new EfdError(
          `A saída do bem por ${rule.label} (${disposal.type}) ainda não é gerada pelo Bipaê.`,
        );
      }
    }
    const entry = installment === 1;
    const credit = !disposedNow || ciap.disposalMonthCredit === true;
    const parcel = credit ? ciapParcel(asset.icms, count) : 0;
    movements.push({
      asset,
      type: entry ? EFD_CIAP_MOVEMENTS.entry : EFD_CIAP_MOVEMENTS.opening,
      date: entry ? asset.enteredOn : start,
      withValues: true,
      ...(credit && { installment, parcelCents: parcel }),
    });
    if (!entry) opening += total;
    if (credit) {
      parcels += parcel;
      installments.push({ code: asset.code, installment });
    }
    if (disposedNow) {
      movements.push({ asset, type: disposal.type, date: disposal.on, withValues: false });
    } else if (installment === count) {
      movements.push({ asset, type: EFD_CIAP_MOVEMENTS.end, date: end, withValues: false });
    }
  }
  const index = ciapOutputIndex(outputs, ciap.stOutputsTaxed);
  const appropriation = round(
    dec(parcels).mul(index.index),
    0,
    EFD_CIAP_RULES.appropriationRounding,
  ).toNumber();
  return {
    movements,
    openingCents: opening,
    parcelsCents: parcels,
    index,
    appropriationCents: appropriation,
    installments,
    skipped,
  };
}
