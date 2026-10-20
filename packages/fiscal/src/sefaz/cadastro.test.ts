import { describe, expect, it } from 'vitest';
import { validatePackageXml } from '../../test/schema';
import { cadastroRequest, parseCadastroResponse } from './cadastro';
import { SefazMessageError } from './messages';

/** Consulta do cadastro de contribuintes na SEFAZ (CadConsultaCadastro4, ConsCad 2.00). */

const consCad = (envelope: string) => /<ConsCad[\s\S]*<\/ConsCad>/.exec(envelope)![0];
const retorno = (inner: string) =>
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4">' +
  `<retConsCad versao="2.00" xmlns="http://www.portalfiscal.inf.br/nfe"><infCons>${inner}</infCons></retConsCad>` +
  '</nfeResultMsg></soap:Body></soap:Envelope>';

describe('consulta de cadastro na SEFAZ', () => {
  it('pelo CNPJ, para a SEFAZ da UF do destinatário, válida no esquema oficial', async () => {
    const req = cadastroRequest({ uf: 'PR', cnpj: '76.484.013/0001-45' });
    expect(req.url).toBe('https://homologacao.nfe.sefa.pr.gov.br/nfe/CadConsultaCadastro4');
    expect(req.contentType).toContain(
      'action="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/consultaCadastro"',
    );
    const xml = consCad(req.envelope);
    expect(xml).toBe(
      '<ConsCad xmlns="http://www.portalfiscal.inf.br/nfe" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>PR</UF><CNPJ>76484013000145</CNPJ></infCons></ConsCad>',
    );
    expect(
      await validatePackageXml(
        xml,
        'NFe_CadConsultaCadastro_NT2026.004_2026-06-08.zip',
        'consCad_v2.00.xsd',
      ),
    ).toEqual([]);
    // Pela inscrição estadual ou pelo CPF também vale; dois de uma vez, não.
    expect(consCad(cadastroRequest({ uf: 'SP', ie: '110.042.490.114' }).envelope)).toContain(
      '<IE>110042490114</IE>',
    );
    expect(() => cadastroRequest({ uf: 'SP', cnpj: '76484013000145', ie: '1' })).toThrow(
      'Informe só um',
    );
    expect(() => cadastroRequest({ uf: 'SP', cpf: '123' })).toThrow('CPF inválido');
  });

  it('UF sem o webservice explica o que fazer', () => {
    // Pela tabela oficial de endereços, o Pará (e AL, AP, CE, DF, MA, PI, RJ, RO, RR, SE e TO) não
    // oferece a consulta pelo webservice.
    expect(() => cadastroRequest({ uf: 'PA', cnpj: '76484013000145' })).toThrow(SefazMessageError);
    expect(() => cadastroRequest({ uf: 'PA', cnpj: '76484013000145' })).toThrow(
      'A SEFAZ de PA não oferece a consulta de cadastro pelo webservice.',
    );
  });

  it('lê o cadastro achado e os motivos de não achar (259, 257)', () => {
    const achou = parseCadastroResponse(
      retorno(
        '<verAplic>PR-v4</verAplic><cStat>111</cStat><xMotivo>Consulta cadastro com uma ocorrencia</xMotivo>' +
          '<UF>PR</UF><CNPJ>76484013000145</CNPJ><dhCons>2026-10-20T12:00:00-03:00</dhCons><cUF>41</cUF>' +
          '<infCad><IE>1018008064</IE><CNPJ>76484013000145</CNPJ><UF>PR</UF><cSit>1</cSit>' +
          '<indCredNFe>1</indCredNFe><indCredCTe>4</indCredCTe><xNome>COMPANHIA DE SANEAMENTO DO PARANA - SANEPAR</xNome>' +
          '<xFant>SANEPAR</xFant><xRegApur>Nao Sujeito ao ICMS - Nao Aplicavel</xRegApur><CNAE>3600601</CNAE>' +
          '<ender><xLgr>RUA ENGENHEIROS REBOUCAS</xLgr><nro>1376</nro><xBairro>REBOUCAS</xBairro>' +
          '<cMun>4106902</cMun><xMun>CURITIBA</xMun><CEP>80210040</CEP></ender></infCad>',
      ),
    );
    expect(achou).toMatchObject({ cStat: '111', found: true });
    expect(achou.entries[0]).toMatchObject({
      ie: '1018008064',
      active: true,
      name: 'COMPANHIA DE SANEAMENTO DO PARANA - SANEPAR',
      address: { street: 'RUA ENGENHEIROS REBOUCAS', cityCode: '4106902', cep: '80210040' },
    });
    // Respostas reais da homologação em 20/10/2026, com o certificado de uma agência sem inscrição.
    const naoContribuinte = parseCadastroResponse(
      retorno(
        '<verAplic>PR-v4</verAplic><cStat>259</cStat><xMotivo>CNPJ da consulta nao cadastrado como contribuinte na UF.</xMotivo><UF>PR</UF><CNPJ>42761086000115</CNPJ><dhCons>2026-10-20T12:00:00-03:00</dhCons><cUF>41</cUF>',
      ),
    );
    expect(naoContribuinte).toMatchObject({ cStat: '259', found: false, entries: [] });
    const naoHabilitado = parseCadastroResponse(
      retorno(
        '<verAplic>SP</verAplic><cStat>257</cStat><xMotivo>Rejeição: Solicitante não habilitado para emissão da NF-e</xMotivo><UF>SP</UF><CNPJ>47508411000156</CNPJ><dhCons>2026-10-20T12:00:00-03:00</dhCons><cUF>35</cUF>',
      ),
    );
    expect(naoHabilitado.cStat).toBe('257');
    expect(() => parseCadastroResponse('<x/>')).toThrow('sem o retorno');
  });
});
