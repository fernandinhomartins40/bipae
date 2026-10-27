/**
 * Maquininhas e TEF no Android por plugin Kotlin (F8-12, ADR-0017 e ADR-0018). Cada adquirente
 * tem o seu SDK, que só existe em Kotlin/Java e só roda no aparelho certo; o que o Bipaê
 * escreve aqui é o contrato comum e o que cada uma exige. Nenhum SDK real está ligado ainda:
 * todas aparecem como "falta configurar" até a conta e o aparelho de teste existirem (E25, E26).
 */
export type SmartAcquirerId = 'pagbank' | 'stone' | 'cielo' | 'getnet' | 'msitef' | 'paygo';

export type SmartAcquirerKind =
  /** A maquininha é o próprio Android: o app Bipaê roda nela e chama o SDK do fabricante. */
  | 'smart'
  /** O Android fala com um pinpad (Bluetooth ou USB) por um servidor TEF. */
  | 'tef';

export interface SmartAcquirerField {
  key: string;
  label: string;
  /** Não vai para o banco do Bipaê nem para o log (regra 10). */
  secret?: boolean;
}

export interface SmartAcquirerInfo {
  id: SmartAcquirerId;
  name: string;
  kind: SmartAcquirerKind;
  /** Nome do SDK ou biblioteca que o plugin Kotlin vai usar. */
  sdk: string;
  /** Dados que a loja informa; nada além do que o contrato da adquirente exige. */
  fields: SmartAcquirerField[];
  /** O que falta no mundo real para virar "Pronto", em português. */
  needs: string[];
  /** Formas de pagamento que o SDK atende. */
  methods: ('credit' | 'debit' | 'voucher' | 'pix')[];
}

export const SMART_ACQUIRERS: Record<SmartAcquirerId, SmartAcquirerInfo> = {
  pagbank: {
    id: 'pagbank',
    name: 'PagBank (PlugPag)',
    kind: 'smart',
    sdk: 'PlugPagServiceWrapper (PagSeguro)',
    fields: [{ key: 'activationCode', label: 'Código de ativação do PagBank', secret: true }],
    needs: [
      'Conta de desenvolvedor do PagBank e o SDK PlugPag',
      'Maquininha smart PagBank (Moderninha Smart, por exemplo) com o app instalado',
    ],
    methods: ['credit', 'debit', 'voucher', 'pix'],
  },
  stone: {
    id: 'stone',
    name: 'Stone (Stone Code)',
    kind: 'smart',
    sdk: 'Stone SDK (POS Android)',
    fields: [{ key: 'stoneCode', label: 'Stone Code da loja' }],
    needs: [
      'Parceria com a Stone e a chave do SDK',
      'Maquininha Stone com Android (Ton T3 ou Stone Smart) e o app instalado',
    ],
    methods: ['credit', 'debit', 'voucher', 'pix'],
  },
  cielo: {
    id: 'cielo',
    name: 'Cielo LIO',
    kind: 'smart',
    sdk: 'Cielo LIO Order Manager',
    fields: [
      { key: 'clientId', label: 'Client ID da Cielo' },
      { key: 'accessToken', label: 'Access token da Cielo', secret: true },
    ],
    needs: [
      'Cadastro no Cielo Developers e credenciais da LIO',
      'Maquininha Cielo LIO com o app instalado',
    ],
    methods: ['credit', 'debit', 'voucher', 'pix'],
  },
  getnet: {
    id: 'getnet',
    name: 'Getnet (Smart)',
    kind: 'smart',
    sdk: 'Getnet SmartPOS SDK',
    fields: [{ key: 'merchantId', label: 'Código do estabelecimento na Getnet' }],
    needs: [
      'Contrato de parceiro com a Getnet e o SDK SmartPOS',
      'Maquininha Getnet Smart com o app instalado',
    ],
    methods: ['credit', 'debit', 'voucher'],
  },
  msitef: {
    id: 'msitef',
    name: 'm-SiTef (Fiserv)',
    kind: 'tef',
    sdk: 'Biblioteca m-SiTef para Android',
    fields: [
      { key: 'host', label: 'Servidor do SiTef' },
      { key: 'storeCode', label: 'Código da loja no SiTef' },
      { key: 'terminalId', label: 'Número do terminal no SiTef' },
    ],
    needs: [
      'Contrato da loja com a Software Express/Fiserv e a biblioteca m-SiTef',
      'Pinpad homologado, pareado por Bluetooth ou USB',
    ],
    methods: ['credit', 'debit', 'voucher', 'pix'],
  },
  paygo: {
    id: 'paygo',
    name: 'PayGo (PGWeb Android)',
    kind: 'tef',
    sdk: 'PayGo Android (interface de automação)',
    fields: [
      { key: 'host', label: 'Servidor do PayGo' },
      { key: 'automationKey', label: 'Chave de automação', secret: true },
    ],
    needs: [
      'Contrato com a Setis/PayGo e a biblioteca de automação',
      'Pinpad homologado, pareado por Bluetooth ou USB',
    ],
    methods: ['credit', 'debit', 'voucher', 'pix'],
  },
};

export const SMART_ACQUIRER_IDS = Object.keys(SMART_ACQUIRERS) as SmartAcquirerId[];

/** O que a loja escolheu neste aparelho (guardado nas preferências; segredo não passa pelo Bipaê). */
export interface SmartTerminalConfig {
  acquirer: SmartAcquirerId | 'none';
  /** Valores dos campos de `SMART_ACQUIRERS[x].fields`, por `key`. */
  values?: Record<string, string>;
}
