/**
 * Regras da EFD ICMS/IPI que mudam por UF (F4-14.b.4, dúvidas D-031 e D-038), como dados com a
 * fonte oficial lida. UF sem linha aqui é "não confirmado": o Bipaê avisa, mas não supõe.
 *
 * Base nacional do Simples: o Protocolo ICMS 03/2011 (cláusula segunda, II) dispensa da EFD as
 * ME e EPP do Simples; o Protocolo ICMS 49/2015 mantém obrigadas as dos estados que as obrigaram
 * até o 1º trimestre de 2014 (LC 123/2006, art. 26, § 4º-C). A lista é de cada UF.
 */

export type EfdUfStatus = 'required' | 'exempt' | 'partial' | 'optional';

export interface EfdUfRule {
  uf: string;
  status: EfdUfStatus;
  /** Desde quando vale (AAAA-MM-DD). */
  from: string;
  /** Explicação curta para a empresa. */
  note: string;
  act: string;
  url: string;
}

/** Empresa do Simples Nacional entrega a EFD ICMS/IPI? (O MEI é dispensado em todas.) */
export const EFD_SIMPLES_BY_UF: readonly EfdUfRule[] = [
  {
    uf: 'AM',
    status: 'exempt',
    from: '2014-01-01',
    note: 'O Amazonas dispensa o MEI e as empresas do Simples Nacional.',
    act: 'Resolução GSEFAZ 16/2014, art. 2º-A (incluído pela Resolução 32/2014)',
    url: 'https://sistemas.sefaz.am.gov.br/get/Normas.do?metodo=viewDoc&uuidDoc=529ad223-afe7-4d37-96b7-76ce4032f39e',
  },
  {
    uf: 'PB',
    status: 'required',
    from: '2020-01-01',
    note: 'Na Paraíba, desde 01/01/2020, as empresas do Simples Nacional entregam a EFD (menos o MEI).',
    act: 'Decreto 38.949/2019 e Decreto 30.478/2009, art. 3º (orientação da SEFAZ-PB)',
    url: 'https://www.sefaz.pb.gov.br/info/declaracoes/sped-fiscal',
  },
  {
    uf: 'MS',
    status: 'partial',
    from: '2014-01-01',
    note: 'Em Mato Grosso do Sul, o Simples entrega a EFD só em alguns casos: se está no Anexo I da Resolução SEFAZ 2.510/2013, se passou do sublimite, se já era obrigado antes de voltar ao Simples ou se outro estabelecimento do mesmo CNPJ é obrigado.',
    act: 'Resolução SEFAZ 2.510/2013 (orientação da SEFAZ-MS)',
    url: 'https://www.sefaz.ms.gov.br/situacoes-em-que-empresas-optantes-pelo-simples-nacional-sao-obrigadas-a-efd/',
  },
];

/**
 * Registro 1601 (vendas com cartão e Pix por instituição de pagamento, Convênio ICMS 134/2016).
 * O Guia Prático diz que "a obrigatoriedade deste registro deve ser verificada junto a cada uma
 * das unidades federativas a partir de 2.023".
 */
export const EFD_1601_BY_UF: readonly EfdUfRule[] = [
  {
    uf: 'MS',
    status: 'required',
    from: '2023-01-01',
    note: 'Mato Grosso do Sul exige o registro 1601 quando houver vendas por cartão ou Pix (obrigatório condicionado).',
    act: 'Resolução SEFAZ 3.298/2023 (anexo da Resolução 2.990/2018)',
    url: 'http://aacpdappls.net.ms.gov.br/appls/legislacao/serc/legato.nsf/e5c724b4c70cb1da04256b1f005348a8/8a1af0f33734157f0425894e004e84e2?OpenDocument',
  },
  {
    uf: 'SC',
    status: 'partial',
    from: '2023-01-01',
    note: 'Santa Catarina dispensa o 1601 de quem entrega no perfil A; os demais perfis entregam.',
    act: 'Portaria SEF 082/2023, requisito XXVI',
    url: 'https://legislacao.sef.sc.gov.br/html/portarias/2023/port_23_082.htm',
  },
  {
    uf: 'BA',
    status: 'exempt',
    from: '2023-01-01',
    note: 'A Bahia dispensa o 1601 até publicar norma que o exija.',
    act: 'Orientação da SEFAZ-BA sobre a EFD (registros dispensados)',
    url: 'https://www.sefaz.ba.gov.br/inspetoria-eletronica/icms/escrituracao-sped/escrituracao-fiscal-digital/informacoes-gerais/',
  },
];

/** A regra da UF que vale na data, ou null quando não está confirmada em fonte oficial. */
export function efdUfRule(table: readonly EfdUfRule[], uf: string, date: string): EfdUfRule | null {
  return table.find((r) => r.uf === uf.toUpperCase() && r.from <= date) ?? null;
}
