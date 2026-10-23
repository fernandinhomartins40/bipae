/**
 * Regras da EFD ICMS/IPI que mudam por UF (F4-14.b.4, dúvidas D-031 e D-038), como dados com a
 * fonte oficial lida. UF sem linha aqui é "não confirmado": o Bipaê avisa, mas não supõe.
 *
 * Base nacional do Simples: o Protocolo ICMS 03/2011 (cláusula segunda, II) dispensa da EFD as
 * ME e EPP do Simples; o Protocolo ICMS 49/2015 mantém obrigadas as dos estados que as obrigaram
 * até o 1º trimestre de 2014 (LC 123/2006, art. 26, § 4º-C). A lista é de cada UF.
 *
 * Quando a mesma UF tem mais de uma linha, a mais nova vem primeiro.
 */

export type EfdUfStatus = 'required' | 'exempt' | 'partial' | 'optional';

export interface EfdUfRule {
  uf: string;
  status: EfdUfStatus;
  /** Desde quando vale (AAAA-MM-DD). */
  from: string;
  /** Último dia em que vale (AAAA-MM-DD), quando a regra tem fim. */
  to?: string;
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
  {
    uf: 'SP',
    status: 'exempt',
    from: '2013-10-01',
    note: 'São Paulo dispensa as empresas do Simples Nacional da EFD; quem quiser pode entregar por opção.',
    act: 'Resposta à Consulta SEFAZ-SP 31.561/2025 (Protocolo ICMS 03/2011, cláusula segunda, II, e Portaria CAT 147/2009, art. 1º)',
    url: 'https://legislacao.fazenda.sp.gov.br/Paginas/RC31561_2025.aspx',
  },
  {
    uf: 'BA',
    status: 'exempt',
    from: '2015-09-01',
    note: 'A Bahia dispensa da EFD o MEI e as empresas do Simples Nacional.',
    act: 'RICMS-BA (Decreto 13.780/2012), art. 248, redação do Decreto 16.284/2015',
    url: 'http://mbusca.sefaz.ba.gov.br/DITRI/normas_complementares/decretos/decreto_2012_13780_ricms_texto_2021.pdf',
  },
  {
    uf: 'PE',
    status: 'exempt',
    from: '2018-09-01',
    note: 'Em Pernambuco, só entrega a EFD quem apura o ICMS no regime normal; arquivo de período no Simples Nacional é recusado.',
    act: 'Decreto 44.650/2017, art. 269-E (Decreto 46.431/2018), e Portaria SF 126/2018, art. 7º-A, V',
    url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Decretos/2017/Dec44650_2017.htm',
  },
  {
    uf: 'PA',
    status: 'exempt',
    from: '2023-08-31',
    note: 'O Pará dispensa as empresas do Simples Nacional da EFD, menos as impedidas de recolher o ICMS pelo Simples (acima do sublimite).',
    act: 'Instrução Normativa SEFA 15/2023, art. 2º, I e § 2º',
    url: 'https://antigo.sefa.pa.gov.br/legislacao/interna/instrucao_normativa/in2023_00015.pdf',
  },
  {
    uf: 'MG',
    status: 'exempt',
    from: '2023-07-01',
    note: 'Minas Gerais dispensa o MEI e as empresas do Simples Nacional da EFD, menos as impedidas de recolher o ICMS pelo Simples.',
    act: 'RICMS/2023 (Decreto 48.589/2023), Anexo V, Parte 1, art. 4º, § 1º',
    url: 'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms_2023_seco/anexov2023_4.html',
  },
  {
    uf: 'ES',
    status: 'exempt',
    from: '2014-01-01',
    note: 'No Espírito Santo, desde 01/01/2014, todos os contribuintes do ICMS entregam a EFD, menos os do Simples Nacional.',
    act: 'RICMS-ES, art. 758-A (orientação da SEFAZ-ES sobre a EFD)',
    url: 'https://sefaz.es.gov.br/informacoes-efd-2',
  },
  {
    uf: 'SC',
    status: 'exempt',
    from: '2014-01-01',
    note: 'Santa Catarina não obriga as empresas do Simples Nacional à EFD (e não aceita a opção voluntária delas).',
    act: 'RICMS-SC, Anexo 11, art. 25, X e § 1º',
    url: 'https://legislacao.sef.sc.gov.br/html/regulamentos/icms/ricms_01_11.htm',
  },
  {
    uf: 'MT',
    status: 'exempt',
    from: '2023-01-01',
    note: 'Mato Grosso dispensa da EFD as empresas do Simples Nacional e o MEI, menos quem passou do sublimite do estado.',
    act: 'Portaria SEFAZ 166/2008, art. 2º-A, § 1º, I, e § 2º (incluídos pela Portaria 247/2022)',
    url: 'http://app1.sefaz.mt.gov.br/0325677500623408/07FA81BED2760C6B84256710004D3940/77141E004E5C2413042574C20050DDC9',
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
  {
    uf: 'PB',
    status: 'required',
    from: '2024-01-01',
    note: 'A Paraíba exige o 1601 desde janeiro de 2024, quando houver vendas por cartão, Pix ou outro meio eletrônico.',
    act: 'Portaria SEFAZ 122/2023 (comunicado da SEFAZ-PB de 04/12/2023)',
    url: 'https://www.sefaz.pb.gov.br/announcements/14241-prazo-de-preenchimento-do-registro-1601-na-efd-comecara-em-janeiro-de-2024',
  },
  {
    uf: 'PB',
    status: 'optional',
    from: '2023-01-01',
    to: '2023-12-31',
    note: 'Na Paraíba, o 1601 foi facultativo até o mês de referência de dezembro de 2023.',
    act: 'Portaria SEFAZ 122/2023, art. 1º',
    url: 'https://www.sefaz.pb.gov.br/legislacao/346-portarias/portarias-2023/13612-portaria-n-00122-2023-sefaz',
  },
  {
    uf: 'CE',
    status: 'required',
    from: '2023-03-01',
    note: 'O Ceará exige o 1601 desde 01/03/2023 de quem recebe por cartão de crédito, débito, Pix e outros meios eletrônicos.',
    act: 'Comunicado da SEFAZ-CE de 14/02/2023',
    url: 'https://www.ce.gov.br/sefaz/2023/02/14/obrigatoriedade-do-registro-1601-na-escrituracao-fiscal-digital-efd-icms-ipi/',
  },
  {
    uf: 'PE',
    status: 'required',
    from: '2024-07-01',
    note: 'Pernambuco exige o 1601; só fica dispensado o estabelecimento com CNAE 3514-0/00 (distribuição de energia elétrica).',
    act: 'Portaria SF 126/2018, art. 2º, I, "b", e Anexo 1 (redação da Portaria SF 087/2024)',
    url: 'https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/Legislacao/Portarias/2018/Port126_2018.htm',
  },
  {
    uf: 'SP',
    status: 'exempt',
    from: '2023-01-01',
    note: 'São Paulo dispensa o 1601 desde a EFD de janeiro de 2023.',
    act: 'Portaria CAT 147/2009, Anexo I, item 17 (incluído pela Portaria SRE 44/2023)',
    url: 'https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-44-de-2023.aspx',
  },
  {
    uf: 'PR',
    status: 'exempt',
    from: '2023-01-01',
    note: 'O Paraná não exige o 1601.',
    act: 'Página da SEFA-PR "Registros dispensados pelo Estado do Paraná"',
    url: 'https://sped.fazenda.pr.gov.br/EFD/Pagina/Registros-dispensados-pelo-Estado-do-Parana',
  },
  {
    uf: 'MG',
    status: 'exempt',
    from: '2023-01-01',
    note: 'Minas Gerais deixou de exigir o 1601: a norma atual exige só o registro 1700.',
    act: 'Resolução SEF 5.726/2023 (revogou a Resolução 5.629/2022, que exigia o 1601 e o 1700)',
    url: 'https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/resolucoes/2023/rr5726_2023.html',
  },
  {
    uf: 'PA',
    status: 'exempt',
    from: '2023-08-31',
    note: 'O Pará dispensa o 1601.',
    act: 'Instrução Normativa SEFA 15/2023, art. 8º',
    url: 'https://antigo.sefa.pa.gov.br/legislacao/interna/instrucao_normativa/in2023_00015.pdf',
  },
  {
    uf: 'GO',
    status: 'required',
    from: '2023-01-01',
    note: 'Goiás exige todos os registros que o Guia Prático deixa para a UF, e o 1601 não está entre os dispensados.',
    act: 'Guia Prático da EFD de Goiás, itens 4.1 e 4.2 (versão 5.0 de 16/12/2022; lido na versão 5.9)',
    url: 'https://goias.gov.br/economia/wp-content/uploads/sites/45/2026/03/Guia_pratico_5.9.pdf',
  },
  {
    uf: 'DF',
    status: 'required',
    from: '2023-01-01',
    note: 'No Distrito Federal, todo registro do perfil A é informado se não houver norma que dispense, e o 1601 não é dispensado.',
    act: 'Tutorial da EFD ICMS/IPI do Distrito Federal, itens 1.06 e 3.21 (versão 1.12.1, de 08/10/2025)',
    url: 'https://static.fazenda.df.gov.br/arquivos/servico-821/Tutorial-da-Escrituracao-Fiscal_-EFD-ICMSIPI_Distrito-Federal_-v_1.12.1_08-10-25.pdf',
  },
  {
    uf: 'MT',
    status: 'exempt',
    from: '2024-01-01',
    note: 'Mato Grosso revogou a exigência do 1601, que valeria a partir de 01/01/2024.',
    act: 'Portaria SEFAZ 166/2008, art. 7º, §§ 2º-B e 2º-C (revogados pela Portaria 236/2023)',
    url: 'http://app1.sefaz.mt.gov.br/0325677500623408/07FA81BED2760C6B84256710004D3940/77141E004E5C2413042574C20050DDC9',
  },
  {
    uf: 'RO',
    status: 'exempt',
    from: '2022-01-01',
    to: '2023-12-31',
    note: 'Rondônia dispensou o 1601 de 01/01/2022 a 31/12/2023.',
    act: 'Instrução Normativa 22/2023/GAB/CRE, art. 1º, I (item 9 do Manual da EFD de Rondônia)',
    url: 'https://www.sefin.ro.gov.br/portalsefin/anexos/IN23-22-Altera-dispositivo-da-Instrucao-Normativa-033_2018_GAB_CRE,-que-instituiu-o-Manual-de-Orientacoes-da-Escrituracao-Fiscal-Digital-para-Contribuintes-do-Estado-de-Rondonia.pdf',
  },
];

/** A regra da UF que vale na data, ou null quando não está confirmada em fonte oficial. */
export function efdUfRule(table: readonly EfdUfRule[], uf: string, date: string): EfdUfRule | null {
  return (
    table.find(
      (r) => r.uf === uf.toUpperCase() && r.from <= date && (r.to === undefined || date <= r.to),
    ) ?? null
  );
}
