/**
 * Leiaute da EFD ICMS/IPI como dados (F4-14.b). Fontes guardadas em `packages/fiscal/sources`:
 * - Guia Prático da EFD ICMS/IPI, versão 3.2.2 (atualização de 11/02/2026), Portal SPED;
 * - Nota Técnica 2025.001 v1.0, leiaute versão 020 (válido de 01/01/2026 a 31/12/2026).
 *
 * Aqui ficam só regras do leiaute: campos de cada registro na ordem oficial, tabelas de códigos e
 * as exceções do registro C100. O gerador (`build.ts`) apenas interpreta estas tabelas.
 */

/**
 * Tipos de campo do leiaute (Guia, Capítulo II, Seção 3):
 * - text: alfanumérico, sem "|" nem caracteres de controle, sem espaço nas pontas;
 * - code: numérico sem casas decimais, como veio ("0", "1058", "5102");
 * - date: ddmmaaaa (recebe AAAA-MM-DD);
 * - monthYear: mmaaaa (recebe AAAA-MM);
 * - money: centavos inteiros escritos com vírgula e duas casas ("1234,56");
 * - rate: percentual decimal com vírgula e duas casas ("18,00");
 * - quantity: quantidade com vírgula e cinco casas ('12,00000'), do texto decimal do XML;
 * - quantity3: quantidade com vírgula e três casas ('12,500'), a do inventário (H010);
 * - factor: fator de conversão ou valor unitário com vírgula e seis casas ('12,000000').
 */
export type EfdFieldType =
  | 'text' | 'code' | 'date' | 'monthYear' | 'money' | 'rate' | 'quantity' | 'quantity3' | 'factor';

type Fields = readonly (readonly [string, EfdFieldType])[];

const closing = (name: string) => [[name, 'code']] as const;
const movement = [['IND_MOV', 'code']] as const;

/** Campos de cada registro, na ordem do leiaute (o campo 01, REG, fica implícito). */
export const EFD_REGISTERS = {
  '0000': [
    ['COD_VER', 'code'],
    ['COD_FIN', 'code'],
    ['DT_INI', 'date'],
    ['DT_FIN', 'date'],
    ['NOME', 'text'],
    ['CNPJ', 'code'],
    ['CPF', 'code'],
    ['UF', 'text'],
    ['IE', 'text'],
    ['COD_MUN', 'code'],
    ['IM', 'text'],
    ['SUFRAMA', 'text'],
    ['IND_PERFIL', 'text'],
    ['IND_ATIV', 'code'],
  ],
  '0001': movement,
  '0005': [
    ['FANTASIA', 'text'],
    ['CEP', 'code'],
    ['END', 'text'],
    ['NUM', 'text'],
    ['COMPL', 'text'],
    ['BAIRRO', 'text'],
    ['FONE', 'text'],
    ['FAX', 'text'],
    ['EMAIL', 'text'],
  ],
  '0100': [
    ['NOME', 'text'],
    ['CPF', 'code'],
    ['CRC', 'text'],
    ['CNPJ', 'code'],
    ['CEP', 'code'],
    ['END', 'text'],
    ['NUM', 'text'],
    ['COMPL', 'text'],
    ['BAIRRO', 'text'],
    ['FONE', 'text'],
    ['FAX', 'text'],
    ['EMAIL', 'text'],
    ['COD_MUN', 'code'],
  ],
  '0150': [
    ['COD_PART', 'text'],
    ['NOME', 'text'],
    ['COD_PAIS', 'code'],
    ['CNPJ', 'code'],
    ['CPF', 'code'],
    ['IE', 'text'],
    ['COD_MUN', 'code'],
    ['SUFRAMA', 'text'],
    ['END', 'text'],
    ['NUM', 'text'],
    ['COMPL', 'text'],
    ['BAIRRO', 'text'],
  ],
  '0190': [
    ['UNID', 'text'],
    ['DESCR', 'text'],
  ],
  '0200': [
    ['COD_ITEM', 'text'],
    ['DESCR_ITEM', 'text'],
    ['COD_BARRA', 'text'],
    ['COD_ANT_ITEM', 'text'],
    ['UNID_INV', 'text'],
    ['TIPO_ITEM', 'code'],
    ['COD_NCM', 'text'],
    ['EX_IPI', 'text'],
    ['COD_GEN', 'code'],
    ['COD_LST', 'text'],
    ['ALIQ_ICMS', 'rate'],
    ['CEST', 'code'],
  ],
  '0220': [
    ['UNID_CONV', 'text'],
    ['FAT_CONV', 'factor'],
    ['COD_BARRA', 'text'],
  ],
  '0990': closing('QTD_LIN_0'),
  B001: [['IND_DAD', 'code']],
  B990: closing('QTD_LIN_B'),
  C001: movement,
  C100: [
    ['IND_OPER', 'code'],
    ['IND_EMIT', 'code'],
    ['COD_PART', 'text'],
    ['COD_MOD', 'text'],
    ['COD_SIT', 'code'],
    ['SER', 'text'],
    ['NUM_DOC', 'code'],
    ['CHV_NFE', 'code'],
    ['DT_DOC', 'date'],
    ['DT_E_S', 'date'],
    ['VL_DOC', 'money'],
    ['IND_PGTO', 'code'],
    ['VL_DESC', 'money'],
    ['VL_ABAT_NT', 'money'],
    ['VL_MERC', 'money'],
    ['IND_FRT', 'code'],
    ['VL_FRT', 'money'],
    ['VL_SEG', 'money'],
    ['VL_OUT_DA', 'money'],
    ['VL_BC_ICMS', 'money'],
    ['VL_ICMS', 'money'],
    ['VL_BC_ICMS_ST', 'money'],
    ['VL_ICMS_ST', 'money'],
    ['VL_IPI', 'money'],
    ['VL_PIS', 'money'],
    ['VL_COFINS', 'money'],
    ['VL_PIS_ST', 'money'],
    ['VL_COFINS_ST', 'money'],
  ],
  C170: [
    ['NUM_ITEM', 'code'],
    ['COD_ITEM', 'text'],
    ['DESCR_COMPL', 'text'],
    ['QTD', 'quantity'],
    ['UNID', 'text'],
    ['VL_ITEM', 'money'],
    ['VL_DESC', 'money'],
    ['IND_MOV', 'code'],
    ['CST_ICMS', 'code'],
    ['CFOP', 'code'],
    ['COD_NAT', 'text'],
    ['VL_BC_ICMS', 'money'],
    ['ALIQ_ICMS', 'rate'],
    ['VL_ICMS', 'money'],
    ['VL_BC_ICMS_ST', 'money'],
    ['ALIQ_ST', 'rate'],
    ['VL_ICMS_ST', 'money'],
    ['IND_APUR', 'code'],
    ['CST_IPI', 'code'],
    ['COD_ENQ', 'text'],
    ['VL_BC_IPI', 'money'],
    ['ALIQ_IPI', 'rate'],
    ['VL_IPI', 'money'],
    ['CST_PIS', 'code'],
    ['VL_BC_PIS', 'money'],
    ['ALIQ_PIS_PERC', 'rate'],
    ['QUANT_BC_PIS', 'quantity'],
    ['ALIQ_PIS_QUANT', 'rate'],
    ['VL_PIS', 'money'],
    ['CST_COFINS', 'code'],
    ['VL_BC_COFINS', 'money'],
    ['ALIQ_COFINS_PERC', 'rate'],
    ['QUANT_BC_COFINS', 'quantity'],
    ['ALIQ_COFINS_QUANT', 'rate'],
    ['VL_COFINS', 'money'],
    ['COD_CTA', 'text'],
    ['VL_ABAT_NT', 'money'],
  ],
  C190: [
    ['CST_ICMS', 'code'],
    ['CFOP', 'code'],
    ['ALIQ_ICMS', 'rate'],
    ['VL_OPR', 'money'],
    ['VL_BC_ICMS', 'money'],
    ['VL_ICMS', 'money'],
    ['VL_BC_ICMS_ST', 'money'],
    ['VL_ICMS_ST', 'money'],
    ['VL_RED_BC', 'money'],
    ['VL_IPI', 'money'],
    ['COD_OBS', 'text'],
  ],
  C990: closing('QTD_LIN_C'),
  D001: movement,
  D990: closing('QTD_LIN_D'),
  E001: movement,
  E100: [
    ['DT_INI', 'date'],
    ['DT_FIN', 'date'],
  ],
  E110: [
    ['VL_TOT_DEBITOS', 'money'],
    ['VL_AJ_DEBITOS', 'money'],
    ['VL_TOT_AJ_DEBITOS', 'money'],
    ['VL_ESTORNOS_CRED', 'money'],
    ['VL_TOT_CREDITOS', 'money'],
    ['VL_AJ_CREDITOS', 'money'],
    ['VL_TOT_AJ_CREDITOS', 'money'],
    ['VL_ESTORNOS_DEB', 'money'],
    ['VL_SLD_CREDOR_ANT', 'money'],
    ['VL_SLD_APURADO', 'money'],
    ['VL_TOT_DED', 'money'],
    ['VL_ICMS_RECOLHER', 'money'],
    ['VL_SLD_CREDOR_TRANSPORTAR', 'money'],
    ['DEB_ESP', 'money'],
  ],
  E116: [
    ['COD_OR', 'code'],
    ['VL_OR', 'money'],
    ['DT_VCTO', 'date'],
    ['COD_REC', 'text'],
    ['NUM_PROC', 'text'],
    ['IND_PROC', 'code'],
    ['PROC', 'text'],
    ['TXT_COMPL', 'text'],
    ['MES_REF', 'monthYear'],
  ],
  E990: closing('QTD_LIN_E'),
  G001: movement,
  G990: closing('QTD_LIN_G'),
  H001: movement,
  H005: [
    ['DT_INV', 'date'],
    ['VL_INV', 'money'],
    ['MOT_INV', 'code'],
  ],
  H010: [
    ['COD_ITEM', 'text'],
    ['UNID', 'text'],
    ['QTD', 'quantity3'],
    ['VL_UNIT', 'factor'],
    ['VL_ITEM', 'money'],
    ['IND_PROP', 'code'],
    ['COD_PART', 'text'],
    ['TXT_COMPL', 'text'],
    ['COD_CTA', 'text'],
    ['VL_ITEM_IR', 'money'],
  ],
  H020: [
    ['CST_ICMS', 'code'],
    ['BC_ICMS', 'money'],
    ['VL_ICMS', 'money'],
  ],
  H990: closing('QTD_LIN_H'),
  K001: movement,
  K990: closing('QTD_LIN_K'),
  '1001': movement,
  '1010': [
    ['IND_EXP', 'text'],
    ['IND_CCRF', 'text'],
    ['IND_COMB', 'text'],
    ['IND_USINA', 'text'],
    ['IND_VA', 'text'],
    ['IND_EE', 'text'],
    ['IND_CART', 'text'],
    ['IND_FORM', 'text'],
    ['IND_AER', 'text'],
    ['IND_GIAF1', 'text'],
    ['IND_GIAF3', 'text'],
    ['IND_GIAF4', 'text'],
    ['IND_REST_RESSARC_COMPL_ICMS', 'text'],
  ],
  '1990': closing('QTD_LIN_1'),
  '9001': movement,
  '9900': [
    ['REG_BLC', 'text'],
    ['QTD_REG_BLC', 'code'],
  ],
  '9990': closing('QTD_LIN_9'),
  '9999': closing('QTD_LIN'),
} as const satisfies Record<string, Fields>;

export type EfdRegister = keyof typeof EFD_REGISTERS;
export type EfdFieldName<R extends EfdRegister> = (typeof EFD_REGISTERS)[R][number][0];

/**
 * Tabela Versão do Leiaute (NT 2025.001, item 3.1.1): o código vale pela data final da
 * escrituração (campo DT_FIN do 0000). Ano novo pede a linha nova aqui, com a NT do ano.
 */
export const EFD_LAYOUT_VERSIONS: readonly { code: string; validFrom: string; validTo: string }[] =
  [
    { code: '019', validFrom: '2025-01-01', validTo: '2025-12-31' },
    { code: '020', validFrom: '2026-01-01', validTo: '2026-12-31' },
  ];

/** Situação do documento (Tabela 4.1.2) a partir do que a SEFAZ respondeu e da finalidade. */
export const EFD_DOCUMENT_SITUATION = {
  /** Documento regular. */
  regular: '00',
  /** Documento cancelado. */
  cancelled: '02',
  /** NF-e complementar (finNFe 2). */
  complementary: '06',
} as const;

/**
 * Exceção 1 do C100: documento cancelado leva só estes campos; os demais vão vazios e não há
 * registros filhos.
 */
export const C100_CANCELLED_FIELDS: readonly EfdFieldName<'C100'>[] = [
  'IND_OPER',
  'IND_EMIT',
  'COD_MOD',
  'COD_SIT',
  'SER',
  'NUM_DOC',
  'CHV_NFE',
];

/** Exceção 9 do C100: na NFC-e (modelo 65) estes campos não são informados. */
export const C100_NFCE_BLANK_FIELDS: readonly EfdFieldName<'C100'>[] = [
  'COD_PART',
  'VL_BC_ICMS_ST',
  'VL_ICMS_ST',
  'VL_IPI',
  'VL_PIS',
  'VL_COFINS',
  'VL_PIS_ST',
  'VL_COFINS_ST',
];

/**
 * C100, campos 26 a 29: quem entrega a EFD-Contribuições do mesmo período fica dispensado e
 * apresenta o campo vazio. Presumido e Real entregam a EFD-Contribuições; no Simples o PIS e a
 * COFINS vão no DAS e a nota não os destaca. Por isso o Bipaê deixa os quatro vazios.
 */
export const C100_PIS_COFINS_FIELDS: readonly EfdFieldName<'C100'>[] = [
  'VL_PIS',
  'VL_COFINS',
  'VL_PIS_ST',
  'VL_COFINS_ST',
];

/**
 * Exceções 2 e 9 do C100: NF-e e NFC-e de emissão própria levam só C100 e C190 (o C170 só
 * aparece com C176, C177, C180 ou C181, que o Bipaê não gera). Sem C170, os itens não são
 * referenciados e, pela validação do 0200 e do 0190, esses cadastros também não vão ao arquivo.
 */
export const EFD_ITEM_DETAIL = { ownIssue: false } as const;

/**
 * C190, campo 10 (VL_RED_BC): obrigatório e maior que zero quando o 2º e o 3º caracteres do
 * CST_ICMS forem 20 ou 70.
 */
export const C190_REDUCED_BASE_CSTS: readonly string[] = ['20', '70'];

/**
 * E110, campos 02 e 06: o débito soma o VL_ICMS dos C190 das saídas e o crédito, o das entradas,
 * com duas trocas: o CFOP 5605 (transferência de saldo devedor) sai dos débitos e entra nos
 * créditos, e o 1605 sai dos créditos e entra nos débitos.
 */
export const E110_CFOP_SIDE: Readonly<Record<string, 'debit' | 'credit'>> = {
  '1605': 'debit',
  '5605': 'credit',
};

/** E110: situações do documento que entram na apuração do período (01 e 07 vão para DEB_ESP). */
export const E110_SITUATIONS: readonly string[] = ['00', '06', '08'];

/** Tabela 5.4: código da obrigação "ICMS a recolher" do E116. */
export const E116_ICMS_DUE_CODE = '000';

/** Tabela Blocos (Guia, Capítulo II, Seção 1): todos obrigatórios, nesta ordem. */
export const EFD_BLOCK_ORDER = ['0', 'B', 'C', 'D', 'E', 'G', 'H', 'K', '1', '9'] as const;
export type EfdBlock = (typeof EFD_BLOCK_ORDER)[number];

/**
 * Blocos sem movimento no arquivo do Bipaê: só a abertura (indicador "1") e o encerramento. O B
 * é o ISS do Distrito Federal (os demais estados informam só B001 e B990); D é transporte e
 * comunicação; G é o CIAP; H é o inventário; K é produção e estoque.
 */
export const EFD_EMPTY_BLOCKS: readonly EfdBlock[] = ['B', 'D', 'G', 'K'];

/**
 * Bloco H, H005 campo 04 (MOT_INV): `h020` diz se o motivo exige o H020 em cada item (motivos 02
 * a 05, Guia 3.2.2); `supported` é falso onde o Bipaê ainda não gera os registros do motivo (o 06
 * pede o H030, valores médios de ICMS ST por item).
 */
export const EFD_INVENTORY_REASONS: Readonly<
  Record<string, { label: string; h020: boolean; supported: boolean }>
> = {
  '01': { label: 'no final do período', h020: false, supported: true },
  '02': { label: 'na mudança de forma de tributação da mercadoria', h020: true, supported: true },
  '03': { label: 'na baixa cadastral ou paralisação', h020: true, supported: true },
  '04': { label: 'na alteração de regime de pagamento', h020: true, supported: true },
  '05': { label: 'por determinação do fisco', h020: true, supported: true },
  '06': { label: 'controle da substituição tributária', h020: false, supported: false },
};

/** Motivo do inventário de 31/12 que o arquivo de fevereiro deve trazer (Guia, H001 e H005). */
export const EFD_YEAR_END_INVENTORY = { month: '02', reason: '01', day: '12-31' } as const;

/** H005, campo 02: o inventário do motivo 01 vai até o segundo mês depois da data (Guia, H005). */
export const EFD_INVENTORY_MAX_MONTHS_AFTER = 2;

/** H010, campo 07 (IND_PROP): 1 e 2 exigem o COD_PART de quem é dono ou possui o item. */
export const EFD_INVENTORY_OWNERSHIP_WITH_PARTY: readonly string[] = ['1', '2'];

/** 0200, campo 07 (TIPO_ITEM): "00" é mercadoria para revenda, o caso do varejo do Bipaê. */
export const EFD_ITEM_TYPE_RESALE = '00';

/**
 * Registro 1010: "S" obriga o registro respectivo. O Bipaê responde "N" em todos; o 1601 (vendas
 * com cartão e Pix por instituição de pagamento) depende da UF e fica como aviso (dúvida D-038).
 */
export const EFD_1010_ANSWERS: Readonly<Record<EfdFieldName<'1010'>, 'S' | 'N'>> = {
  IND_EXP: 'N',
  IND_CCRF: 'N',
  IND_COMB: 'N',
  IND_USINA: 'N',
  IND_VA: 'N',
  IND_EE: 'N',
  IND_CART: 'N',
  IND_FORM: 'N',
  IND_AER: 'N',
  IND_GIAF1: 'N',
  IND_GIAF3: 'N',
  IND_GIAF4: 'N',
  IND_REST_RESSARC_COMPL_ICMS: 'N',
};

/** Código do Brasil na Tabela de Países do Bacen, como a NF-e (cPais) e o 0150 usam. */
export const EFD_BRAZIL_COUNTRY = '1058';
