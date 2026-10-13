import { findFcp } from '../tables/rates';
import { nfceEndpoints } from '../tables/nfce-endpoints';
import { nfeEndpoints } from '../tables/nfe-endpoints';
import { el } from '../nfce/xml';

/**
 * Mensagens dos webservices da NF-e e da NFC-e (MOC 7.0, item 5, leiaute 4.00) e o envelope
 * SOAP 1.2 que as leva. Só ambiente de homologação (tpAmb = 2): produção exige pedido explícito
 * do dono do projeto (regra 4 do CLAUDE.md), e por isso nem existe opção para isso aqui.
 */
export type SefazService =
  'NFeStatusServico' | 'NFeAutorizacao' | 'NFeRetAutorizacao' | 'NFeConsultaProtocolo';

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const TP_AMB_HOMOLOGACAO = '2';

/** Namespace do WSDL e método de cada serviço da versão 4.00. */
const WSDL: Record<SefazService, { ns: string; method: string }> = {
  NFeStatusServico: { ns: `${NFE_NS}/wsdl/NFeStatusServico4`, method: 'nfeStatusServicoNF' },
  NFeAutorizacao: { ns: `${NFE_NS}/wsdl/NFeAutorizacao4`, method: 'nfeAutorizacaoLote' },
  NFeRetAutorizacao: { ns: `${NFE_NS}/wsdl/NFeRetAutorizacao4`, method: 'nfeRetAutorizacaoLote' },
  NFeConsultaProtocolo: { ns: `${NFE_NS}/wsdl/NFeConsultaProtocolo4`, method: 'nfeConsultaNF' },
};

export class SefazMessageError extends Error {}

export interface SefazRequest {
  service: SefazService;
  url: string;
  /** Envelope SOAP completo. */
  envelope: string;
  /** Content-Type do SOAP 1.2, com a ação do serviço. */
  contentType: string;
}

/** Código IBGE da UF (cUF), da tabela oficial do Portal da NF-e. */
export function ufCode(uf: string): string {
  const code = findFcp(uf)?.cUF;
  if (!code) throw new SefazMessageError(`UF desconhecida: ${uf}.`);
  return code;
}

/** Endereço de homologação do serviço para o modelo (55 NF-e, 65 NFC-e) e a UF do emitente. */
export function sefazUrl(model: '55' | '65', uf: string, service: SefazService): string {
  const url =
    model === '65'
      ? nfceEndpoints(uf)?.webservices.homologacao[service]
      : nfeEndpoints(uf)?.webservices.homologacao[service];
  if (!url) {
    throw new SefazMessageError(
      `Sem endereço de ${service} da ${model === '65' ? 'NFC-e' : 'NF-e'} em homologação para a UF ${uf}.`,
    );
  }
  return url;
}

function envelope(service: SefazService, url: string, payload: string): SefazRequest {
  const { ns, method } = WSDL[service];
  return {
    service,
    url,
    envelope:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      `<soap12:Body><nfeDadosMsg xmlns="${ns}">${payload}</nfeDadosMsg></soap12:Body></soap12:Envelope>`,
    contentType: `application/soap+xml; charset=utf-8; action="${ns}/${method}"`,
  };
}

/** Consulta o status do serviço (consStatServ). */
export function statusRequest(model: '55' | '65', uf: string): SefazRequest {
  const payload = el(
    'consStatServ',
    [el('tpAmb', TP_AMB_HOMOLOGACAO), el('cUF', ufCode(uf)), el('xServ', 'STATUS')],
    { xmlns: NFE_NS, versao: '4.00' },
  );
  return envelope('NFeStatusServico', sefazUrl(model, uf, 'NFeStatusServico'), payload);
}

/** Retira a declaração XML: a nota vai dentro do lote. */
const withoutDeclaration = (xml: string) => xml.replace(/^\s*<\?xml[^>]*\?>\s*/, '');

/**
 * Envia notas assinadas num lote (enviNFe). Com uma nota só, pede processamento síncrono
 * (indSinc = 1): a resposta já traz o protocolo, sem recibo para consultar depois.
 */
export function authorizationRequest(input: {
  model: '55' | '65';
  uf: string;
  /** Identificador do lote, só dígitos (1 a 15), controlado por quem envia. */
  batchId: string;
  signedXmls: string[];
}): SefazRequest {
  if (!/^\d{1,15}$/.test(input.batchId))
    throw new SefazMessageError('Número do lote inválido (1 a 15 dígitos).');
  if (input.signedXmls.length < 1 || input.signedXmls.length > 50) {
    throw new SefazMessageError('O lote leva de 1 a 50 notas.');
  }
  for (const xml of input.signedXmls) {
    if (!/<Signature[\s>]/.test(xml))
      throw new SefazMessageError('Nota sem assinatura não pode ser enviada.');
    if (!xml.includes('<tpAmb>2</tpAmb>')) {
      throw new SefazMessageError('Só notas de homologação (tpAmb 2) podem ser enviadas.');
    }
    if (!xml.includes(`<mod>${input.model}</mod>`)) {
      throw new SefazMessageError(`A nota não é do modelo ${input.model}.`);
    }
  }
  const sync = input.signedXmls.length === 1 ? '1' : '0';
  const payload =
    `<enviNFe xmlns="${NFE_NS}" versao="4.00">${el('idLote', input.batchId)}${el('indSinc', sync)}` +
    `${input.signedXmls.map(withoutDeclaration).join('')}</enviNFe>`;
  return envelope('NFeAutorizacao', sefazUrl(input.model, input.uf, 'NFeAutorizacao'), payload);
}

/** Consulta o resultado de um lote enviado sem processamento síncrono (consReciNFe). */
export function receiptRequest(model: '55' | '65', uf: string, receipt: string): SefazRequest {
  if (!/^\d{15}$/.test(receipt))
    throw new SefazMessageError('Número do recibo inválido (15 dígitos).');
  const payload = el('consReciNFe', [el('tpAmb', TP_AMB_HOMOLOGACAO), el('nRec', receipt)], {
    xmlns: NFE_NS,
    versao: '4.00',
  });
  return envelope('NFeRetAutorizacao', sefazUrl(model, uf, 'NFeRetAutorizacao'), payload);
}

/** Consulta a situação de uma nota pela chave (consSitNFe). */
export function consultRequest(uf: string, accessKey: string): SefazRequest {
  if (!/^[0-9A-Z]{44}$/.test(accessKey)) throw new SefazMessageError('Chave de acesso inválida.');
  const model = accessKey.slice(20, 22);
  if (model !== '55' && model !== '65')
    throw new SefazMessageError('A chave não é de NF-e nem de NFC-e.');
  const payload = el(
    'consSitNFe',
    [el('tpAmb', TP_AMB_HOMOLOGACAO), el('xServ', 'CONSULTAR'), el('chNFe', accessKey)],
    { xmlns: NFE_NS, versao: '4.00' },
  );
  return envelope('NFeConsultaProtocolo', sefazUrl(model, uf, 'NFeConsultaProtocolo'), payload);
}
