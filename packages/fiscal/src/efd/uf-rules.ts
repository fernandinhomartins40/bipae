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
  {
    uf: 'RS',
    status: 'exempt',
    from: '2015-09-29',
    note: 'O Rio Grande do Sul não obriga as empresas do Simples Nacional à EFD.',
    act: 'Instrução Normativa DRP 45/98, Título I, Capítulo LI, item 1.1.5 (incluído pela IN RE 051/15)',
    url: 'https://legislacao.sefaz.rs.gov.br/Site/Document.aspx?inpKey=109367',
  },
  {
    uf: 'RN',
    status: 'required',
    from: '2014-01-01',
    note: 'No Rio Grande do Norte, desde 01/01/2014, as empresas do Simples Nacional entregam a EFD; só o MEI e as unidades especiais são dispensados.',
    act: 'RICMS-RN (Decreto 31.825/2022), art. 145, caput e § 2º; dispensa do Simples só até 31/12/2013 (Decreto 24.120/2013)',
    url: 'http://www.sefaz.rn.gov.br/wp-json/nextcloud/v1/download?filePath=SEFAZ-GOVRN%2FImpostos%2FLegisla%C3%A7%C3%A3o%2FICMS%2FRegulamentos%2FRegulamentos%20do%20ICMS%2FRegulamento%20do%20ICMS%20RN%20-%20Vigente%20-%20Decreto%2031.825-2022.doc',
  },
  {
    uf: 'AL',
    status: 'required',
    from: '2016-01-01',
    note: 'Em Alagoas, desde 01/01/2016, as ME e EPP do Simples Nacional entregam a EFD; o MEI é dispensado.',
    act: 'Instrução Normativa SEF 46/2008, art. 1º, § 1º, IV, e § 5º (incluídos pela IN GSEF 04/2014)',
    url: 'https://gcs2.sefaz.al.gov.br/#/documentos/visualizar-documento?acess=1&key=cMeNfPhQb4Y%3D',
  },
  {
    uf: 'AC',
    status: 'exempt',
    from: '2012-03-07',
    note: 'O Acre não obriga as empresas do Simples Nacional à EFD, menos as impedidas de recolher o ICMS pelo Simples por excesso de sublimite.',
    act: 'RICMS-AC (Decreto 008/1998), art. 121-C, § 10, I, e § 16 (Decreto 3.496/2012)',
    url: 'https://www.legis.ac.gov.br/detalhar/4788',
  },
  {
    uf: 'TO',
    status: 'exempt',
    from: '2011-01-01',
    note: 'No Tocantins, desde 01/01/2011, todos os contribuintes do ICMS entregam a EFD, menos os do Simples Nacional.',
    act: 'RICMS-TO, art. 384-E (orientação da SEFAZ-TO sobre o SPED Fiscal)',
    url: 'https://www.to.gov.br/sefaz/sped-fiscal/6g809qx2c8wf',
  },
  {
    uf: 'SE',
    status: 'exempt',
    from: '2013-10-01',
    note: 'Sergipe dispensa da EFD o MEI e as empresas do Simples Nacional, menos as impedidas de recolher o ICMS pelo Simples.',
    act: 'RICMS-SE (Decreto 21.400/2002), art. 349-C, I e II (Protocolos ICMS 03/2011 e 91/2013)',
    url: 'https://legislacaoonline.sefaz.se.gov.br/ICMS/Regulamento%20do%20ICMS-RICMS/Regulamento%20do%20ICMS%20vigente-2002-sem-historico.pdf',
  },
  {
    uf: 'GO',
    status: 'exempt',
    from: '2013-10-01',
    note: 'Goiás dispensa da EFD o MEI e as empresas do Simples Nacional, menos as impedidas de recolher o ICMS pelo Simples.',
    act: 'RCTE-GO (Decreto 4.852/1997), art. 356-D, § 4º, I e II (redação do Decreto 8.117/2013)',
    url: 'https://appasp.economia.go.gov.br/legislacao/arquivos/Rcte/RCTE.htm',
  },
  {
    uf: 'GO',
    status: 'exempt',
    from: '2011-07-18',
    to: '2013-09-30',
    note: 'Goiás dispensava da EFD todas as empresas do Simples Nacional.',
    act: 'RCTE-GO (Decreto 4.852/1997), art. 356-D, § 4º (redação do Decreto 7.402/2011)',
    url: 'https://appasp.economia.go.gov.br/legislacao/arquivos/Rcte/RCTE.htm',
  },
  {
    uf: 'DF',
    status: 'partial',
    from: '2019-07-01',
    note: 'No Distrito Federal, o Simples entrega a EFD; ficam fora o MEI, quem faturou no ano anterior até o limite do MEI (e, desde 2022, também comprou até esse limite) e quem começou a atividade no ano. Quem passa do limite no ano entrega desde janeiro.',
    act: 'Portaria SEFP 192/2019, art. 1º, §§ 1º e 2º (inciso II na redação da Portaria 285/2022), com o Decreto 39.789/2019, art. 5º',
    url: 'https://www.sinj.df.gov.br/sinj/Norma/a4e8e28df21f4c4a90aef62db1ce9dba/sefp_prt_192_2019_rep.html',
  },
  {
    uf: 'CE',
    status: 'exempt',
    from: '2017-01-01',
    note: 'O Ceará dispensa da EFD as ME e EPP do Simples Nacional desde janeiro de 2017 (a obrigação da IN 54/2016 foi retirada).',
    act: 'Instrução Normativa SEFAZ 54/2016, alterada pela IN 42/2020 (Comunicados COATE 01/2021 e 27/2022)',
    url: 'https://www.sefaz.ce.gov.br/2022/10/28/dispensa-de-entrega-da-efd-icms-ipi-para-contribuintes-do-simples-nacional-e-do-regime-outros/',
  },
  {
    uf: 'PR',
    status: 'exempt',
    from: '2014-01-01',
    note: 'O Paraná dispensa da EFD o MEI e as ME e EPP do Simples Nacional enquanto estiverem no regime; quem sai do Simples entrega desde o mês do desenquadramento.',
    act: 'Norma de Procedimento Fiscal 056/2015, itens 9, 9.1 e 9.3 (Protocolo ICMS 03/2011)',
    url: 'http://www.sefanet.pr.gov.br/dados/SEFADOCUMENTOS/103201500056.pdf',
  },
  {
    uf: 'RO',
    status: 'exempt',
    from: '2018-05-01',
    note: 'Rondônia dispensa da EFD o MEI, o produtor rural pessoa física e as empresas do Simples Nacional que recolhem o ICMS pelo Simples.',
    act: 'RICMS-RO (Decreto 22.721/2018), Anexo XIII, art. 107, parágrafo único',
    url: 'https://legislacao.sefin.ro.gov.br/normas/117',
  },
  {
    // Quinta rodada (24/10/2026): texto do Decreto 33.623/2017 lido no Diário Oficial do MA,
    // p. 35. "Art. 2º Este Decreto entra em vigor na data de sua publicação, retroagindo seus
    // efeitos a 12 de setembro de 2017" (data em que o Decreto 33.322/2017 tinha reescrito o § 5º).
    uf: 'MA',
    status: 'exempt',
    from: '2017-09-12',
    note: 'O Maranhão dispensa da EFD o MEI e as ME e EPP do Simples Nacional, menos as impedidas de recolher o ICMS pelo Simples (acima do sublimite).',
    act: 'RICMS-MA (Decreto 19.714/2003), art. 321-D, § 5º, I e II, redação do Decreto 33.623/2017 (DOE-MA de 10/11/2017)',
    url: 'https://diariooficial.ma.gov.br/download.php?arq=EX20171110',
  },
  {
    // Quinta rodada: RICMS-AP, Anexo I, art. 222-L, § 7º, II, e § 9º (Decreto 8.200/2013, DOE-AP
    // de 27/12/2013): "a dispensa prevista no caput encerrar-se-á em 1º de janeiro de 2016, quando
    // estarão obrigados à Escrituração Fiscal Digital - EFD". O texto consolidado mais novo do
    // SIGDoc é de 13/07/2021; a busca no Diário Oficial do AP não achou alteração do art. 222-L
    // depois disso.
    uf: 'AP',
    status: 'required',
    from: '2016-01-01',
    note: 'No Amapá, desde 01/01/2016, as ME e EPP do Simples Nacional entregam a EFD; o MEI (SIMEI) continua dispensado.',
    act: 'RICMS-AP (Decreto 2.269/1998), Anexo I, art. 222-L, § 7º e § 9º (Decreto 8.200/2013)',
    url: 'https://sigdoc.ap.gov.br/public/arquivo/35f6952d-3b86-4938-9976-4ac99906b297/download',
  },
  {
    // Quinta rodada: RICMS-RR "atualizado até outubro 2026", art. 289-I, parágrafo único
    // (Decreto 16.362-E/2013): "Para os estabelecimentos mencionados no inciso II, a dispensa
    // prevista no caput encerrar-se-á em 1º de janeiro de 2016, quando estarão obrigados à
    // Escrituração Fiscal Digital - EFD".
    uf: 'RR',
    status: 'required',
    from: '2016-01-01',
    note: 'Em Roraima, desde 01/01/2016, as ME e EPP do Simples Nacional entregam a EFD; o MEI (SIMEI) continua dispensado.',
    act: 'RICMS-RR (Decreto 4.335-E/2001), art. 289-I, parágrafo único (Decreto 16.362-E/2013)',
    url: 'https://www.sefaz.rr.gov.br/downloads/legislacao?file=02%20-%20LEGISLACAO%20ESTADUAL%2F03%20-%20REGULAMENTO%20DE%20ICMS%20-%20ATUALIZADO%20-%20DECRETO%204.335%202001%2FREGULAMENTO%20DE%20ICMS%20-%20DECRETO%204.335%20DE%2003.08.01%20-%20ATUALIZADO%20ATE%20OUTUBRO%202026.pdf',
  },
  {
    // Sexta rodada (27/10/2026): Resolução SEFAZ 720/2014, Anexo VII da Parte II, art. 1º, § 1º, I
    // (LegisWeb id=265403): a EFD é obrigatória aos contribuintes do Estado, menos "aos contribuintes
    // optantes pelo regime do Simples Nacional, desde que não estejam impedidos de recolher o ICMS"
    // por terem ultrapassado o sublimite estadual. Confirmado pelo Manual da EFD da SEFAZ-RJ (2019).
    uf: 'RJ',
    status: 'partial',
    from: '2014-02-10',
    note: 'No Rio de Janeiro, o Simples Nacional é dispensado da EFD enquanto estiver dentro do sublimite estadual; passou do sublimite e ficou impedido de recolher o ICMS pelo Simples, entrega.',
    act: 'Resolução SEFAZ 720/2014, Anexo VII da Parte II, art. 1º, § 1º, I, e art. 8º (quem sai do Simples fica obrigado a partir da exclusão)',
    url: 'https://www.legisweb.com.br/legislacao/?id=265403',
  },
  {
    // Sexta rodada (26/10/2026): Guia Prático Estadual v1.6 (item 3.a.I) cita o art. 404 do
    // RICMS-PI: EFD obrigatória a todos os contribuintes de ICMS e/ou IPI, com dispensa só do MEI
    // (SIMEI, § 1º); o item 3.b diz que os optantes do Simples entregam desde janeiro de 2021.
    uf: 'PI',
    status: 'required',
    from: '2021-01-01',
    note: 'No Piauí, desde 01/01/2021, as ME e EPP do Simples Nacional entregam a EFD (perfil C); o MEI (SIMEI) é dispensado.',
    act: 'RICMS-PI (Decreto 21.866/2023), art. 404, e Guia Prático da EFD do Piauí v1.6, itens 3.a.I, 3.b e 3.h',
    url: 'https://portal.sefaz.pi.gov.br/documentos?folderId=69d900afcd07d979b43efee6',
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
    uf: 'MT',
    status: 'exempt',
    from: '2023-01-01',
    to: '2023-12-31',
    note: 'Em Mato Grosso, a exigência do 1601 em 2023 foi adiada para 2024, com efeito retroativo a 01/01/2023.',
    act: 'Portaria SEFAZ 089/2023, arts. 1º e 2º (nova redação do art. 7º, § 2º-B, da Portaria 166/2008)',
    url: 'https://iomat.mt.gov.br/legislacao/diario_oficial/download/14808',
  },
  {
    uf: 'RO',
    status: 'exempt',
    from: '2022-01-01',
    note: 'Rondônia dispensa o 1601 desde 01/01/2022; a volta da exigência em 2024 foi revogada.',
    act: 'Instrução Normativa 33/2018/GAB/CRE, Manual da EFD, item 9 (redação da IN 22/2023, art. 1º, I; o inciso II foi revogado pela IN 75/2023)',
    url: 'https://legislacao.sefin.ro.gov.br/normas/1355',
  },
  {
    uf: 'RS',
    status: 'exempt',
    from: '2022-10-24',
    note: 'O Rio Grande do Sul dispensa o 1601.',
    act: 'Instrução Normativa DRP 45/98, Título I, Capítulo LI, item 4.2, "g" (incluída pela IN RE 090/22)',
    url: 'https://legislacao.sefaz.rs.gov.br/Site/Document.aspx?inpKey=109367',
  },
  {
    uf: 'RN',
    status: 'required',
    from: '2025-01-01',
    note: 'O Rio Grande do Norte exige o 1601 desde 01/01/2025.',
    act: 'RICMS-RN (Decreto 31.825/2022), art. 145, §§ 14 e 15, II (redação do Decreto 33.399/2024)',
    url: 'http://www.sefaz.rn.gov.br/wp-json/nextcloud/v1/download?filePath=SEFAZ-GOVRN%2FImpostos%2FLegisla%C3%A7%C3%A3o%2FICMS%2FRegulamentos%2FRegulamentos%20do%20ICMS%2FRegulamento%20do%20ICMS%20RN%20-%20Vigente%20-%20Decreto%2031.825-2022.doc',
  },
  {
    uf: 'RN',
    status: 'optional',
    from: '2024-01-01',
    to: '2024-12-31',
    note: 'No Rio Grande do Norte, o 1601 foi facultativo nas escriturações de 2024.',
    act: 'RICMS-RN (Decreto 31.825/2022), art. 145, § 15, I (redação do Decreto 33.399/2024)',
    url: 'http://www.sefaz.rn.gov.br/wp-json/nextcloud/v1/download?filePath=SEFAZ-GOVRN%2FImpostos%2FLegisla%C3%A7%C3%A3o%2FICMS%2FRegulamentos%2FRegulamentos%20do%20ICMS%2FRegulamento%20do%20ICMS%20RN%20-%20Vigente%20-%20Decreto%2031.825-2022.doc',
  },
  {
    uf: 'RN',
    status: 'required',
    from: '2023-01-01',
    to: '2023-12-31',
    note: 'No Rio Grande do Norte, o 1601 era exigido desde 01/01/2023 na redação original; o decreto de 2024 só mudou 2024 em diante.',
    act: 'RICMS-RN (Decreto 31.825/2022), art. 145, §§ 14 e 15, II (redação original do Decreto 32.137/2022)',
    url: 'http://www.sefaz.rn.gov.br/wp-json/nextcloud/v1/download?filePath=SEFAZ-GOVRN%2FImpostos%2FLegisla%C3%A7%C3%A3o%2FICMS%2FRegulamentos%2FRegulamentos%20do%20ICMS%2FRegulamento%20do%20ICMS%20RN%20-%20Vigente%20-%20Decreto%2031.825-2022.doc',
  },
  {
    uf: 'ES',
    status: 'optional',
    from: '2023-01-01',
    note: 'No Espírito Santo, o 1601 é facultativo desde 01/01/2023; a obrigação prevista para 2024 foi revogada.',
    act: 'RICMS-ES, art. 758-B, § 10, I (Decreto 5.363-R/2023), com o inciso II revogado pelo Decreto 5.504-R/2023',
    url: 'https://conteudo.seg.es.gov.br/APINormas/AtoNormativo/9625682',
  },
  {
    uf: 'AL',
    status: 'required',
    from: '2023-02-01',
    note: 'Alagoas exige o 1601 desde 01/02/2023.',
    act: 'Instrução Normativa SEF 19/2009, art. 4º, § 1º, IV, e § 6º (incluído pela IN SEF 13/2023)',
    url: 'https://gcs2.sefaz.al.gov.br/#/documentos/visualizar-documento?acess=1&key=Bl7NLn6W130%3D',
  },
  {
    uf: 'SE',
    status: 'partial',
    from: '2025-11-07',
    note: 'Sergipe exige o 1601 só de quem tem atividades mistas (ICMS e ISS), desde que o § 10-A foi revogado em 07/11/2025.',
    act: 'RICMS-SE (Decreto 21.400/2002), art. 349-C, § 10 (Decreto 558/2024), com o § 10-A revogado pelo Decreto 1.283/2025',
    url: 'https://legislacaoonline.sefaz.se.gov.br/ICMS/Regulamento%20do%20ICMS-RICMS/Regulamento%20do%20ICMS%20vigente-2002-com-historico.pdf',
  },
  {
    uf: 'SE',
    status: 'required',
    from: '2025-01-01',
    to: '2025-11-06',
    note: 'Em Sergipe, de 01/01/2025 a 06/11/2025, todos os declarantes da EFD informavam o 1601.',
    act: 'RICMS-SE (Decreto 21.400/2002), art. 349-C, § 10-A (redação do Decreto 756/2024, revogado pelo Decreto 1.283/2025)',
    url: 'https://legislacaoonline.sefaz.se.gov.br/ICMS/Regulamento%20do%20ICMS-RICMS/Regulamento%20do%20ICMS%20vigente-2002-com-historico.pdf',
  },
  {
    uf: 'SE',
    status: 'required',
    from: '2023-01-01',
    to: '2023-12-31',
    note: 'Em Sergipe, em 2023, todos os declarantes da EFD informavam o 1601.',
    act: 'RICMS-SE (Decreto 21.400/2002), art. 349-C, § 10 (redação original do Decreto 227/2022, vigente até 15/01/2024)',
    url: 'https://legislacaoonline.sefaz.se.gov.br/ICMS/Regulamento%20do%20ICMS-RICMS/Regulamento%20do%20ICMS%20vigente-2002-com-historico.pdf',
  },
  {
    // Quinta rodada (24/10/2026): Solução de Consulta 12/2024 da SEFAZ-MA, publicada no Diário
    // Oficial do MA de 07/06/2024, p. 25: "não havendo dispensa formal do Estado do Maranhão, a
    // partir de 01/01/2023, é obrigatória a apresentação do Registro das Operações com Instrumentos
    // de Pagamentos Eletrônicos REG 1601". A busca no Diário Oficial não achou dispensa posterior.
    uf: 'MA',
    status: 'required',
    from: '2023-01-01',
    note: 'O Maranhão exige o 1601 desde 01/01/2023 de quem recebe por cartão de crédito, débito, Pix ou outro meio eletrônico.',
    act: 'Solução de Consulta SEFAZ-MA 12/2024, item II (DOE-MA de 07/06/2024)',
    url: 'https://diariooficial.ma.gov.br/download.php?arq=EX20240607',
  },
  {
    // Sexta rodada (27/10/2026): a Portaria SEFAZ-AC 565/2016 (PDF da SEFAZ-AC, atualizado até a
    // 268/2024), art. 3º, VI, redação da Portaria 377/2023: a EFD leva o registro 1601 no lugar do 1600.
    uf: 'AC',
    status: 'required',
    from: '2023-03-29',
    note: 'O Acre exige o 1601 na EFD desde 29/03/2023 (no lugar do registro 1600).',
    act: 'Portaria SEFAZ-AC 565/2016, art. 3º, VI (redação da Portaria 377/2023)',
    url: 'https://sefaz.ac.gov.br/2021/?p=11663',
  },
  {
    // Resolução SEFAZ-RJ 551/2023 (DOE-RJ de 19/07/2023) e 625/2024 republicada (DOE-RJ de 12/03/2024):
    // o § 2º do art. 6º-A do Anexo VII dispensa "os registros 0210, C191, C495, C591, 1601, 1700,
    // 1900, 1960, 1970 e 1980" (texto literal lido no LegisWeb id=456517).
    uf: 'RJ',
    status: 'exempt',
    from: '2023-07-19',
    note: 'O Rio de Janeiro dispensa o registro 1601 de todos os contribuintes desde 19/07/2023.',
    act: 'Resolução SEFAZ 720/2014, Anexo VII da Parte II, art. 6º-A, § 2º (redação das Resoluções 551/2023 e 625/2024; texto consolidado lido em 28/10/2026)',
    url: 'https://www.legisweb.com.br/legislacao/?id=265403',
  },
  {
    // Resposta à Consulta SEFAZ-TO 41/2023: a Portaria SEFAZ 93/2023 (altera a 733/2017) torna o
    // 1601 obrigatório "sempre que houver informação a ser prestada", com efeitos desde 01/01/2023.
    uf: 'TO',
    status: 'required',
    from: '2023-01-01',
    note: 'O Tocantins exige o 1601 desde 01/01/2023 sempre que houver informação a prestar (vendas por cartão, Pix e meios eletrônicos).',
    act: 'Portaria SEFAZ-TO 93/2023 (altera a 733/2017) e Resposta à Consulta SEFAZ-TO 41/2023',
    url: 'https://www.to.gov.br/sefaz/sped-fiscal/6g809qx2c8wf',
  },
  {
    // Portaria SEFAZ-PI 22/2020, arts. 1º e 2º: os registros fora da lista de dispensa são
    // obrigatórios; o 1601 não está na lista (nem na Portaria 06/2022, segundo a auditoria do dono).
    // Parecer SEFAZ-PI 202/2023 conclui o mesmo.
    uf: 'PI',
    status: 'required',
    from: '2023-01-01',
    note: 'O Piauí exige o 1601: ele não está na lista de registros dispensados e os não listados são obrigatórios.',
    act: 'Portaria SEFAZ-PI 22/2020, arts. 1º e 2º, e Parecer SEFAZ-PI/GETRI 202/2023',
    url: 'https://portal.sefaz.pi.gov.br/documentos?folderId=69d900afcd07d979b43efee6',
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
