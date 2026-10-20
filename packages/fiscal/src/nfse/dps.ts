import { el, opt, text } from '../nfce/xml';
import { brasiliaDateTime } from '../nfce/sale';
import { findCompanyRegime } from '../regimes';
import { findNfseService } from '../tables/nfse-services';

/**
 * DPS da NFS-e Nacional (F5-13.b): a Declaração de Prestação de Serviço que a empresa assina e
 * manda à Sefin Nacional, que devolve a NFS-e. Leiaute v1.01 em produção (esquemas de 09/02/2026
 * e Anexo I, com as regras de negócio citadas pelo código de erro). Só produção restrita
 * (tpAmb 2, regra 4 do projeto).
 *
 * O grupo do IBS e da CBS fica de fora: para o Simples ele só é obrigatório a partir de 2027
 * (nota do Anexo I) e, para os demais, é facultativo no leiaute em produção (regra E0850; o
 * leiaute da NT 009 entra conforme o cronograma da Receita, dúvida D-036).
 */
export const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse';
const TP_AMB = '2';
const MAX_RATE = 5;

/** Situação perante o Simples Nacional (opSimpNac) e regime de apuração (regApTribSN), pelo leiaute. */
const SIMPLES_SITUATION: Record<string, { opSimpNac: '1' | '2' | '3'; regApTribSN?: '1' | '2' }> = {
  mei: { opSimpNac: '2' },
  // ME/EPP com tudo apurado pelo Simples.
  simples: { opSimpNac: '3', regApTribSN: '1' },
  // Acima do sublimite: tributos federais pelo Simples e o ISSQN pela legislação do município.
  'simples-excesso': { opSimpNac: '3', regApTribSN: '2' },
  presumido: { opSimpNac: '1' },
  real: { opSimpNac: '1' },
};

/** Tributação do ISSQN (tribISSQN) e retenção (tpRetISSQN), como no leiaute. */
export const NFSE_ISS_TAXATION = {
  tributavel: '1',
  imunidade: '2',
  exportacao: '3',
  naoIncidencia: '4',
} as const;
export const NFSE_ISS_RETENTION = { naoRetido: '1', tomador: '2', intermediario: '3' } as const;

export interface DpsAddress {
  /** Município do IBGE (7 dígitos). */
  cityCode: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement?: string | null;
  district: string | null;
}

export interface DpsInput {
  issuer: {
    /** CNPJ (ou CPF) do prestador, que é quem emite a DPS (tpEmit 1). */
    taxId: string | null;
    /** Inscrição municipal: obrigatória quando o prestador tem cadastro complementar no município. */
    municipalRegistration?: string | null;
    phone?: string | null;
    email?: string | null;
    /** Município do estabelecimento, que emite a DPS (cLocEmi). */
    cityCode: string | null;
    regime: string | null;
  };
  /** Série da DPS: 1 a 49999 é emissão por aplicativo próprio (Anexo I, campo serie). */
  series: number;
  number: number;
  /** Momento da emissão (ISO) e data da prestação do serviço (competência, AAAA-MM-DD). */
  issuedAt: string;
  competence: string;
  taker?: {
    taxId: string | null;
    name: string | null;
    email?: string | null;
    phone?: string | null;
    address?: DpsAddress | null;
  } | null;
  service: {
    /** Código de tributação nacional (cTribNac), da lista nacional de serviços. */
    code: string;
    description: string;
    /** Código NBS, quando a empresa informa. */
    nbs?: string | null;
    /** Município onde o serviço é prestado (cLocPrestacao). */
    placeCityCode: string | null;
  };
  valueCents: number;
  /** Desconto incondicionado (abate da base do ISSQN). */
  discountCents?: number;
  iss: {
    taxation?: keyof typeof NFSE_ISS_TAXATION;
    retention?: keyof typeof NFSE_ISS_RETENTION;
    /** Alíquota do ISSQN do serviço no município ("2.00"), quando a regra pede. */
    rate?: string | null;
    /**
     * O convênio do município de incidência está "Ativo" no Sistema Nacional NFS-e? Vem da API de
     * parâmetros municipais da Sefin; decide se a alíquota vai ou não na DPS (regras E0617 a E0640).
     * Null quando não foi possível saber.
     */
    municipalAgreementActive: boolean | null;
    /**
     * O município emissor deixa emitir só com o cadastro CNPJ da Receita? Quando não (false), a
     * regra E0084 pede o CNPJ e a inscrição municipal no cadastro do município (CNC NFS-e).
     */
    municipalRfbDefault?: boolean | null;
  };
  /**
   * Total aproximado dos tributos (Lei 12.741/2012): o percentual do Simples (pTotTribSN) para
   * ME/EPP, ou os percentuais federal, estadual e municipal para os demais. O MEI não informa.
   */
  approximateTaxes?: {
    simplesPercent?: string | null;
    federal?: string | null;
    state?: string | null;
    municipal?: string | null;
  };
  appVersion: string;
}

export type DpsResult =
  { ok: true; xml: string; id: string; notes: string[] } | { ok: false; pending: string[] };

const onlyDigits = (text: string | null | undefined) => (text ?? '').replace(/\D/g, '');
const money = (cents: number) => (cents / 100).toFixed(2);
const percent = (text: string | null | undefined) => {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec((text ?? '').trim());
  return m ? `${m[1]}.${(m[2] ?? '').padEnd(2, '0')}` : null;
};

/** Id da DPS: "DPS" + município (7) + tipo de inscrição (1 CPF, 2 CNPJ) + inscrição (14) + série (5) + número (15). */
export function dpsId(input: { cityCode: string; taxId: string; series: number; number: number }) {
  const taxId = onlyDigits(input.taxId);
  const type = taxId.length === 11 ? '1' : '2';
  return (
    `DPS${input.cityCode}${type}${taxId.padStart(14, '0')}` +
    `${String(input.series).padStart(5, '0')}${String(input.number).padStart(15, '0')}`
  );
}

function address(a: DpsAddress) {
  return el('end', [
    el('endNac', [el('cMun', a.cityCode!), el('CEP', onlyDigits(a.cep))]),
    el('xLgr', text(a.street!.trim())),
    el('nro', text(a.number!.trim())),
    opt('xCpl', a.complement?.trim() || undefined),
    el('xBairro', text(a.district!.trim())),
  ]);
}

const complete = (a: DpsAddress | null | undefined) =>
  Boolean(
    a?.cityCode &&
    /^\d{7}$/.test(a.cityCode) &&
    onlyDigits(a.cep).length === 8 &&
    a.street?.trim() &&
    a.number?.trim() &&
    a.district?.trim(),
  );

export function buildDps(input: DpsInput): DpsResult {
  const pending: string[] = [];
  const notes: string[] = [];
  const i = input.issuer;
  const regime = i.regime ? findCompanyRegime(i.regime) : null;
  const situation = regime ? SIMPLES_SITUATION[regime.id] : undefined;
  if (!situation) pending.push('Falta o regime tributário da empresa (Empresas e lojas).');
  const taxId = onlyDigits(i.taxId);
  if (taxId.length !== 14 && taxId.length !== 11) pending.push('Falta o CNPJ da empresa.');
  if (!i.cityCode || !/^\d{7}$/.test(i.cityCode)) pending.push('Falta o município da empresa.');
  if (input.series < 1 || input.series > 49999) {
    pending.push('A série da DPS do aplicativo próprio vai de 1 a 49999 (Anexo I).');
  }
  if (input.number < 1) pending.push('Número da DPS inválido.');
  const issuedAt = brasiliaDateTime(input.issuedAt);
  // A competência é a data da prestação e não pode ser depois da emissão (E0015).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.competence) || input.competence > issuedAt.slice(0, 10)) {
    pending.push('A data da prestação do serviço não pode ser depois da emissão da nota.');
  }

  // ---------------------------------------------------------------- serviço
  const service = findNfseService(input.service.code);
  if (!service) {
    pending.push(
      'Escolha o serviço na lista nacional de serviços (código de tributação nacional).',
    );
  } else if (service.requiredGroup) {
    pending.push(
      service.requiredGroup === 'obra'
        ? 'Serviço de construção civil: a NFS-e com os dados da obra ainda não é emitida pelo Bipaê.'
        : 'Serviço ligado a evento: a NFS-e com os dados do evento ainda não é emitida pelo Bipaê.',
    );
  }
  const description = input.service.description.trim();
  if (!description) pending.push('Descreva o serviço prestado.');
  const place = input.service.placeCityCode;
  if (!place || !/^\d{7}$/.test(place))
    pending.push('Falta o município onde o serviço foi prestado.');
  if (input.valueCents <= 0) pending.push('O valor do serviço precisa ser maior que zero.');
  const discount = input.discountCents ?? 0;
  if (discount < 0 || discount > input.valueCents) {
    pending.push('O desconto não pode passar do valor do serviço.');
  }

  // ---------------------------------------------------------------- tomador
  const t = input.taker ?? null;
  const takerTaxId = onlyDigits(t?.taxId);
  if (t && takerTaxId.length !== 11 && takerTaxId.length !== 14) {
    pending.push('O CPF ou o CNPJ do tomador está incompleto.');
  }
  if (t && !t.name?.trim()) pending.push('Falta o nome do tomador.');

  // ---------------------------------------------------------------- ISSQN
  const taxation = NFSE_ISS_TAXATION[input.iss.taxation ?? 'tributavel'];
  const retention = NFSE_ISS_RETENTION[input.iss.retention ?? 'naoRetido'];
  const isMei = situation?.opSimpNac === '2';
  if (taxation !== '1') {
    pending.push(
      'Imunidade, exportação e não incidência do ISSQN ainda não são emitidas pelo Bipaê.',
    );
  }
  if (isMei && retention !== '1') pending.push('O MEI não tem retenção do ISSQN (regra E0583).');
  if (retention !== '1') {
    // Retenção pede o tomador identificado e com endereço (E0204, E0237).
    if (!t || !takerTaxId) pending.push('A retenção do ISSQN pede o CPF ou o CNPJ do tomador.');
    if (!complete(t?.address)) pending.push('A retenção do ISSQN pede o endereço do tomador.');
  }
  if (service?.incidence === 'tomador' && !complete(t?.address)) {
    pending.push(
      'Neste serviço o ISSQN é do município do tomador: informe o endereço dele (regra E0234).',
    );
  }
  // A alíquota vai ou não pela situação no Simples, pela retenção e pelo convênio do município.
  if (
    input.iss.municipalRfbDefault === false &&
    !isMei &&
    !onlyDigits(input.issuer.municipalRegistration)
  ) {
    pending.push(
      'Este município exige a inscrição municipal na NFS-e: a empresa precisa estar no cadastro de contribuintes da prefeitura (regra E0084). Informe-a em Empresas e lojas.',
    );
  }
  const agreement = input.iss.municipalAgreementActive;
  let needsRate: boolean | null;
  if (!situation || isMei || taxation !== '1') needsRate = false;
  else if (situation.opSimpNac === '1') needsRate = agreement === null ? null : !agreement;
  else if (situation.regApTribSN === '1') needsRate = retention === '1' ? false : true;
  else needsRate = agreement === null ? null : !agreement;
  if (needsRate === null) {
    pending.push(
      'Não deu para saber se o município está com o convênio ativo no Sistema Nacional NFS-e. Tente de novo em instantes.',
    );
  }
  const rate = percent(input.iss.rate);
  if (needsRate && !rate) {
    pending.push(
      'Informe a alíquota do ISSQN deste serviço no município (no cadastro do serviço).',
    );
  }
  if (needsRate && rate && Number(rate) > MAX_RATE) {
    pending.push('A alíquota do ISSQN não pode passar de 5% (regra E0595).');
  }

  // ---------------------------------------------------------------- total aproximado dos tributos
  const approx = input.approximateTaxes ?? {};
  let totTrib = '';
  if (isMei) {
    totTrib = el('totTrib', el('indTotTrib', '0'));
  } else if (situation?.opSimpNac === '3') {
    const sn = percent(approx.simplesPercent);
    if (!sn) {
      pending.push(
        'Informe o percentual aproximado dos tributos do Simples (Empresas e lojas, NFS-e), exigido para ME e EPP.',
      );
    }
    totTrib = el('totTrib', el('pTotTribSN', sn ?? '0.00'));
  } else if (situation) {
    const fed = percent(approx.federal);
    const est = percent(approx.state);
    const mun = percent(approx.municipal);
    if (!fed || !est || !mun) {
      pending.push(
        'Informe os percentuais aproximados dos tributos federais, estaduais e municipais (Empresas e lojas, NFS-e).',
      );
    }
    totTrib = el(
      'totTrib',
      el('pTotTrib', [
        el('pTotTribFed', fed ?? '0.00'),
        el('pTotTribEst', est ?? '0.00'),
        el('pTotTribMun', mun ?? '0.00'),
      ]),
    );
  }

  if (pending.length > 0) return { ok: false, pending: [...new Set(pending)] };

  const id = dpsId({ cityCode: i.cityCode!, taxId, series: input.series, number: input.number });
  const imRegistration = onlyDigits(i.municipalRegistration);
  const xml = el(
    'DPS',
    el(
      'infDPS',
      [
        el('tpAmb', TP_AMB),
        el('dhEmi', issuedAt),
        el('verAplic', text(input.appVersion.slice(0, 20))),
        el('serie', String(input.series)),
        el('nDPS', String(input.number)),
        el('dCompet', input.competence),
        el('tpEmit', '1'),
        // NT 009: a finalidade passa para o infDPS; o Bipaê emite só a NFS-e regular.
        el('finNFSe', '0'),
        el('cLocEmi', i.cityCode!),
        // O prestador que emite não informa o próprio nome nem o endereço (E0121, E0129).
        el('prest', [
          el(taxId.length === 11 ? 'CPF' : 'CNPJ', taxId),
          opt('IM', imRegistration || undefined),
          opt('fone', onlyDigits(i.phone).length >= 6 ? onlyDigits(i.phone) : undefined),
          opt('email', i.email?.trim() || undefined),
          el('regTrib', [
            el('opSimpNac', situation!.opSimpNac),
            opt('regApTribSN', situation!.regApTribSN),
            el('regEspTrib', '0'),
          ]),
        ]),
        t
          ? el('toma', [
              el(takerTaxId.length === 11 ? 'CPF' : 'CNPJ', takerTaxId),
              el('xNome', text(t.name!.trim().slice(0, 300))),
              complete(t.address) ? address(t.address!) : '',
              opt('fone', onlyDigits(t.phone).length >= 6 ? onlyDigits(t.phone) : undefined),
              opt('email', t.email?.trim() || undefined),
            ])
          : '',
        el('serv', [
          el('locPrest', el('cLocPrestacao', place!)),
          el('cServ', [
            el('cTribNac', service!.code),
            el('xDescServ', text(description.slice(0, 2000))),
            opt('cNBS', onlyDigits(input.service.nbs) || undefined),
          ]),
        ]),
        el('valores', [
          el('vServPrest', el('vServ', money(input.valueCents))),
          discount > 0 ? el('vDescCondIncond', el('vDescIncond', money(discount))) : '',
          el('trib', [
            el('tribMun', [
              el('tribISSQN', taxation),
              el('tpRetISSQN', retention),
              needsRate ? el('pAliq', rate!) : '',
            ]),
            totTrib,
          ]),
        ]),
      ],
      { Id: id },
    ),
    { xmlns: NFSE_NS, versao: '1.01' },
  );
  if (!t) notes.push('NFS-e sem tomador identificado.');
  return { ok: true, xml, id, notes };
}
