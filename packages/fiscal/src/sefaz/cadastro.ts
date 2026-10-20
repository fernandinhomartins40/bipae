import { el } from '../nfce/xml';
import { nfeEndpoints } from '../tables/nfe-endpoints';
import { descendant, findAll, parseXml, textOf, type XmlElement } from '../xml-reader';
import { SefazMessageError, type SefazRequest } from './messages';

/**
 * Consulta do cadastro de contribuintes do ICMS na SEFAZ da UF (webservice CadConsultaCadastro4,
 * leiaute ConsCad 2.00 do pacote "010d_v1.01 ... ws de Consulta CCC", NT 2026.004): pelo CNPJ, CPF
 * ou inscrição estadual, devolve a inscrição, a situação, o nome e o endereço. Serve para a NF-e
 * sair com a inscrição estadual certa do destinatário. Só homologação (regra 4 do projeto).
 */
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const WSDL_NS = `${NFE_NS}/wsdl/CadConsultaCadastro4`;

export interface CadastroQuery {
  /** UF onde a inscrição é procurada (a do destinatário). */
  uf: string;
  cnpj?: string;
  cpf?: string;
  ie?: string;
}

export function cadastroRequest(query: CadastroQuery): SefazRequest {
  const cnpj = query.cnpj?.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  const cpf = query.cpf?.replace(/\D/g, '');
  const ie = query.ie?.replace(/\D/g, '');
  const filled = [cnpj, cpf, ie].filter(Boolean);
  if (filled.length !== 1) {
    throw new SefazMessageError('Informe só um: CNPJ, CPF ou inscrição estadual.');
  }
  if (cnpj && !/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) throw new SefazMessageError('CNPJ inválido.');
  if (cpf && !/^\d{11}$/.test(cpf)) throw new SefazMessageError('CPF inválido.');
  if (ie && !/^\d{2,14}$/.test(ie)) throw new SefazMessageError('Inscrição estadual inválida.');
  const url = nfeEndpoints(query.uf)?.webservices.homologacao.NFeConsultaCadastro;
  if (!url) {
    throw new SefazMessageError(
      `A SEFAZ de ${query.uf} não oferece a consulta de cadastro pelo webservice. Confira a inscrição estadual com o cliente.`,
    );
  }
  const payload = el(
    'ConsCad',
    el('infCons', [
      el('xServ', 'CONS-CAD'),
      el('UF', query.uf),
      cnpj ? el('CNPJ', cnpj) : cpf ? el('CPF', cpf) : el('IE', ie!),
    ]),
    { xmlns: NFE_NS, versao: '2.00' },
  );
  return {
    service: 'NFeConsultaCadastro',
    url,
    envelope:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      `<soap12:Body><nfeDadosMsg xmlns="${WSDL_NS}">${payload}</nfeDadosMsg></soap12:Body></soap12:Envelope>`,
    contentType: `application/soap+xml; charset=utf-8; action="${WSDL_NS}/consultaCadastro"`,
  };
}

export interface CadastroEntry {
  ie: string;
  cnpj: string | null;
  cpf: string | null;
  uf: string;
  /** Habilitado como contribuinte do ICMS (cSit 1)? */
  active: boolean;
  name: string;
  tradeName: string | null;
  /** Regime de apuração como a SEFAZ escreve, quando informa. */
  regime: string | null;
  cnae: string | null;
  address: {
    street: string | null;
    number: string | null;
    complement: string | null;
    district: string | null;
    cityCode: string | null;
    city: string | null;
    cep: string | null;
  } | null;
}

export interface CadastroResult {
  cStat: string;
  xMotivo: string;
  /** 111 (um cadastro) ou 112 (vários): a consulta achou. */
  found: boolean;
  entries: CadastroEntry[];
}

const entry = (cad: XmlElement): CadastroEntry => {
  const ender = descendant(cad, 'ender');
  return {
    ie: textOf(cad, 'IE') ?? '',
    cnpj: textOf(cad, 'CNPJ') ?? null,
    cpf: textOf(cad, 'CPF') ?? null,
    uf: textOf(cad, 'UF') ?? '',
    active: textOf(cad, 'cSit') === '1',
    name: textOf(cad, 'xNome') ?? '',
    tradeName: textOf(cad, 'xFant') ?? null,
    regime: textOf(cad, 'xRegApur') ?? null,
    cnae: textOf(cad, 'CNAE') ?? null,
    address: ender
      ? {
          street: textOf(ender, 'xLgr') ?? null,
          number: textOf(ender, 'nro') ?? null,
          complement: textOf(ender, 'xCpl') ?? null,
          district: textOf(ender, 'xBairro') ?? null,
          cityCode: textOf(ender, 'cMun') ?? null,
          city: textOf(ender, 'xMun') ?? null,
          cep: textOf(ender, 'CEP') ?? null,
        }
      : null,
  };
};

/** Retorno retConsCad: 111 e 112 trazem os cadastros; o resto é o motivo, como a SEFAZ escreveu. */
export function parseCadastroResponse(responseXml: string): CadastroResult {
  const ret = descendant(parseXml(responseXml), 'retConsCad');
  const info = descendant(ret, 'infCons');
  const cStat = textOf(info, 'cStat');
  if (!info || !cStat) {
    throw new SefazMessageError('A SEFAZ respondeu sem o retorno da consulta de cadastro.');
  }
  const found = cStat === '111' || cStat === '112';
  return {
    cStat,
    xMotivo: textOf(info, 'xMotivo') ?? '',
    found,
    entries: found ? findAll(info, 'infCad').map(entry) : [],
  };
}
