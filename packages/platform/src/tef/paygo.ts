import {
  declined,
  TefError,
  type TefDriver,
  type TefOperation,
  type TefReply,
  type TefSession,
  type TefStep,
  type TefTransactionResult,
} from './protocol';

/**
 * PayGo (PGWebLib) no computador do caixa (F8-11, ADR-0018). Como no SiTef, o Bipaê não traz a
 * biblioteca: ela vem do contrato da loja com a PayGo (item E10) e o Desktop/Conector só repassa
 * as chamadas. A biblioteca real conversa em ciclos "executa, recebe pedido de dados, devolve
 * dados"; `PayGoLib` é essa conversa já normalizada em eventos, e o adaptador nativo faz a tradução
 * dos códigos numéricos. Esta máquina de estados e o simulador estão testados, mas NÃO foram
 * conferidos contra a PGWebLib nem contra um pinpad homologado: isso é a homologação do E10
 * (F8-11.c). O que a documentação deixar em aberto vira configuração, nunca suposição escondida.
 */

export interface PayGoConfig {
  /** Nome da automação cadastrada no portal da PayGo. */
  automationName: string;
  /** Versão da automação, como cadastrada. */
  automationVersion: string;
  /** Ponto de captura (terminal) fornecido pela PayGo. */
  captureTerminal: string;
  /** Endereço do servidor de pagamento, quando o contrato pede. */
  host?: string;
}

/** Um dado que a biblioteca pede ao operador ou ao cliente. */
export interface PayGoPrompt {
  /** Identificador do dado, devolvido em `addParam`. */
  id: number;
  title: string;
  kind: 'menu' | 'text' | 'number' | 'money' | 'secret';
  options?: { value: string; label: string }[];
  minLength?: number;
  maxLength?: number;
}

/** O que cada execução da biblioteca devolve. */
export type PayGoExec =
  | { kind: 'display'; text: string; target: 'operator' | 'customer' | 'both' }
  | { kind: 'wait'; text: string }
  | { kind: 'getData'; prompt: PayGoPrompt }
  | { kind: 'done'; ret: number; message: string; pendingId?: string }
  | { kind: 'noHost' };

export interface PayGoResult {
  nsu?: string;
  hostNsu?: string;
  authorizationCode?: string;
  brand?: string;
  acquirer?: string;
  customerReceipt?: string;
  merchantReceipt?: string;
}

export interface PayGoLib {
  init(config: PayGoConfig): Promise<number>;
  begin(call: {
    operation: 'sale' | 'cancel';
    amountCents: number;
    method?: string;
    installments?: number;
    reference: string;
    originalNsu?: string;
    originalDate?: string;
  }): Promise<number>;
  addParam(id: number, value: string): Promise<void>;
  exec(): Promise<PayGoExec>;
  result(): Promise<PayGoResult>;
  /** Segunda fase: confirma ou desfaz a transação pendente. */
  confirm(call: { pendingId: string; confirm: boolean }): Promise<void>;
  abort(): Promise<void>;
}

/** Sem biblioteca neste computador: tudo vira "falta configurar". */
export class MissingPayGoLib implements PayGoLib {
  private fail(): never {
    throw new TefError(
      'A biblioteca da PayGo (PGWebLib) ainda não está instalada neste computador. Falta configurar.',
      'not_configured',
    );
  }
  init(): Promise<number> {
    return this.fail();
  }
  begin(): Promise<number> {
    return this.fail();
  }
  addParam(): Promise<void> {
    return this.fail();
  }
  exec(): Promise<PayGoExec> {
    return this.fail();
  }
  result(): Promise<PayGoResult> {
    return this.fail();
  }
  confirm(): Promise<void> {
    return this.fail();
  }
  abort(): Promise<void> {
    return this.fail();
  }
}

const lines = (text: string | undefined) =>
  text ? text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')) : [];

export class PayGoDriver implements TefDriver {
  readonly id = 'paygo';
  private initialized = false;
  private readonly pending = new Set<string>();

  constructor(
    private readonly lib: PayGoLib,
    private readonly config: PayGoConfig,
  ) {}

  private async ensureInit() {
    if (this.initialized) return;
    const c = this.config;
    if (!c.automationName?.trim() || !c.automationVersion?.trim() || !c.captureTerminal?.trim()) {
      throw new TefError(
        'Falta configurar a PayGo: nome e versão da automação e ponto de captura.',
        'not_configured',
      );
    }
    const ret = await this.lib.init(c);
    if (ret !== 0) {
      throw new TefError(
        `A PayGo recusou a configuração (código ${ret}). Confira automação e ponto de captura.`,
        'rejected',
      );
    }
    this.initialized = true;
  }

  async begin(operation: TefOperation): Promise<TefSession> {
    await this.ensureInit();
    return new PayGoSession(this.lib, operation, (id) => this.pending.add(id));
  }

  async finish(transactionId: string, confirmed: boolean): Promise<void> {
    if (!this.pending.delete(transactionId)) return; // confirmar duas vezes não estraga
    await this.lib.confirm({ pendingId: transactionId, confirm: confirmed });
  }
}

class PayGoSession implements TefSession {
  private started = false;
  private closed = false;
  private prompt: PayGoPrompt | null = null;

  constructor(
    private readonly lib: PayGoLib,
    private readonly operation: TefOperation,
    private readonly remember: (id: string) => void,
  ) {}

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.started) await this.lib.abort().catch(() => undefined);
  }

  async next(reply?: TefReply): Promise<TefStep> {
    if (this.closed) return { kind: 'done', result: declined('Operação encerrada.') };
    const op = this.operation;
    if (!this.started) {
      this.started = true;
      const ret = await this.lib.begin({
        operation: op.kind,
        amountCents: op.amountCents,
        ...(op.kind === 'sale'
          ? {
              method: op.method,
              ...(op.installments && { installments: op.installments }),
              reference: op.saleId,
            }
          : { reference: 'cancelamento', originalNsu: op.nsu, originalDate: op.originalDate }),
      });
      if (ret !== 0) {
        this.closed = true;
        throw new TefError(
          `A PayGo não aceitou a operação (código ${ret}). Confira os dados e tente de novo.`,
          'rejected',
        );
      }
    } else if (reply?.kind === 'cancel') {
      await this.abort();
      return { kind: 'done', result: declined('Operação cancelada pelo operador.') };
    } else if (this.prompt) {
      const answer = reply?.kind === 'value' ? reply.value : '';
      await this.lib.addParam(this.prompt.id, answer);
      this.prompt = null;
    }
    return this.step();
  }

  private async step(): Promise<TefStep> {
    const res = await this.lib.exec();
    switch (res.kind) {
      case 'display':
        return { kind: 'message', target: res.target, text: res.text };
      case 'wait':
        return { kind: 'wait', text: res.text };
      case 'getData': {
        this.prompt = res.prompt;
        const p = res.prompt;
        if (p.kind === 'menu') {
          return { kind: 'menu', title: p.title, options: p.options ?? [] };
        }
        return {
          kind: 'input',
          title: p.title,
          format: p.kind === 'money' ? 'money' : p.kind === 'number' ? 'number' : 'text',
          minLength: p.minLength ?? 0,
          maxLength: p.maxLength ?? 64,
          secret: p.kind === 'secret',
        };
      }
      case 'noHost':
        this.closed = true;
        throw new TefError(
          'Sem comunicação com a PayGo. Confira a rede; a venda segue sem cartão.',
          'unavailable',
        );
      case 'done': {
        this.closed = true;
        if (res.ret !== 0)
          return { kind: 'done', result: declined(res.message || 'Não aprovada.') };
        const data = await this.lib.result();
        const id = res.pendingId ?? `paygo-${Date.now()}`;
        this.remember(id);
        const result: TefTransactionResult = {
          approved: true,
          message: res.message || 'Aprovada',
          transactionId: id,
          ...(data.nsu && { nsu: data.nsu }),
          ...(data.hostNsu && { hostNsu: data.hostNsu }),
          ...(data.authorizationCode && { authorizationCode: data.authorizationCode }),
          ...(data.brand && { brand: data.brand }),
          ...(data.acquirer && { acquirer: data.acquirer }),
          receipts: {
            customer: lines(data.customerReceipt),
            merchant: lines(data.merchantReceipt),
          },
        };
        return { kind: 'done', result };
      }
    }
  }
}

/**
 * PGWebLib de mentira (F8-11): cumpre o mesmo roteiro sem hardware nem conta. Pelos centavos do
 * valor: terminados em 13 são negados; em 99, a PayGo fica fora do ar. Sem forma de pagamento
 * definida, pergunta crédito ou débito.
 */
export class SimulatedPayGoLib implements PayGoLib {
  readonly confirmed: { pendingId: string; confirm: boolean }[] = [];
  readonly params = new Map<number, string>();
  private queue: PayGoExec[] = [];
  private nsu = 0;
  private cents = 0;

  constructor(private readonly options: { initReturns?: number } = {}) {}

  async init(): Promise<number> {
    return this.options.initReturns ?? 0;
  }

  async begin(call: { amountCents: number; method?: string }): Promise<number> {
    this.cents = call.amountCents;
    this.params.clear();
    this.queue = [{ kind: 'display', target: 'both', text: 'Insira, passe ou aproxime o cartão' }];
    if (!call.method) {
      this.queue.push({
        kind: 'getData',
        prompt: {
          id: 1,
          title: 'Forma de pagamento',
          kind: 'menu',
          options: [
            { value: 'credit', label: 'Cartão de crédito' },
            { value: 'debit', label: 'Cartão de débito' },
          ],
        },
      });
    }
    this.queue.push({ kind: 'wait', text: 'Digite a senha no pinpad' });
    return 0;
  }

  async addParam(id: number, value: string): Promise<void> {
    this.params.set(id, value);
  }

  async exec(): Promise<PayGoExec> {
    const next = this.queue.shift();
    if (next) return next;
    if (this.cents % 100 === 99) return { kind: 'noHost' };
    if (this.cents % 100 === 13) {
      return { kind: 'done', ret: 1, message: 'Transação negada pelo emissor (simulador)' };
    }
    this.nsu++;
    return { kind: 'done', ret: 0, message: 'Aprovada', pendingId: `PG${this.nsu}` };
  }

  async result(): Promise<PayGoResult> {
    const nsu = String(this.nsu).padStart(6, '0');
    const valor = (this.cents / 100).toFixed(2).replace('.', ',');
    return {
      nsu,
      hostNsu: `H${nsu}`,
      authorizationCode: `SIM${nsu}`,
      brand: 'SIMULADO',
      acquirer: 'PayGo (simulador)',
      customerReceipt: ['MERCADINHO DE TESTE', 'VIA CLIENTE', `VALOR R$ ${valor}`].join('\r\n'),
      merchantReceipt: ['MERCADINHO DE TESTE', 'VIA ESTABELECIMENTO', `VALOR R$ ${valor}`].join(
        '\r\n',
      ),
    };
  }

  async confirm(call: { pendingId: string; confirm: boolean }): Promise<void> {
    this.confirmed.push(call);
  }

  async abort(): Promise<void> {
    this.queue = [];
  }
}
