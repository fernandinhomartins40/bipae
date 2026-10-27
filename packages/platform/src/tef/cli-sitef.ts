import {
  declined,
  TefError,
  type TefDriver,
  type TefMethod,
  type TefOperation,
  type TefReply,
  type TefSession,
  type TefStep,
  type TefTransactionResult,
} from './protocol';

/**
 * SiTef (Software Express) pela biblioteca CliSiTef, no computador do caixa (F8-11, ADR-0018).
 * O Bipaê não traz a biblioteca: ela vem do contrato da loja com a Software Express/Fiserv (item
 * E10) e é carregada pelo Bipaê Desktop ou pelo Conector, que só repassam as chamadas.
 *
 * Esta classe é a máquina de estados do laço `IniciaFuncaoSiTefInterativo` /
 * `ContinuaFuncaoSiTefInterativo`: traduz cada comando do SiTef num passo da tela (`TefStep`) e a
 * resposta da tela no que o SiTef espera. Os códigos abaixo seguem a documentação pública do
 * CliSiTef, mas ainda NÃO foram conferidos contra a biblioteca real nem contra um pinpad:
 * isso é a homologação do E10. Enquanto isso, o que a documentação deixa em aberto é
 * configuração (modalidades), nunca suposição escondida (regra 3 do CLAUDE.md).
 */

/** Retorno do SiTef que manda continuar chamando `continue`. */
export const SITEF_CONTINUE = 10000;
/** Operação cancelada pelo operador e cancelada no pinpad pelo cliente. */
export const SITEF_CANCELLED_BY_OPERATOR = -2;
export const SITEF_CANCELLED_BY_CUSTOMER = -6;
export const SITEF_NO_HOST = -5;

/** Comandos do laço interativo. */
export const SITEF_COMMAND = {
  fieldResult: 0,
  messageOperator: 1,
  messageCustomer: 2,
  messageBoth: 3,
  menuTitle: 4,
  clearOperator: 11,
  clearCustomer: 12,
  clearBoth: 13,
  clearMenuTitle: 14,
  header: 15,
  clearHeader: 16,
  confirm: 20,
  menu: 21,
  pause: 22,
  checkInterrupt: 23,
  collectField: 30,
  collectMoney: 34,
  collectSensitive: 41,
} as const;

/** Campos devolvidos pelo SiTef que o Bipaê usa. */
export const SITEF_FIELD = {
  customerReceipt: 121,
  merchantReceipt: 122,
  nsuSitef: 133,
  nsuHost: 134,
  authorizationCode: 135,
} as const;

export interface CliSiTefConfig {
  /** Endereço do servidor SiTef (IP ou nome). */
  host: string;
  storeCode: string;
  terminalId: string;
  /**
   * Número da modalidade de cada forma de pagamento, como o contrato da loja define. Sem número, a
   * operação sai como "genérica" (0) e o SiTef mostra o menu para o operador escolher.
   */
  modalities?: Partial<Record<TefMethod | 'cancel', number>>;
  /** Parâmetros adicionais do contrato (ParametrosAdicionais da biblioteca). */
  extra?: string;
}

/** Resposta de cada chamada do laço. */
export interface CliSiTefContinue {
  ret: number;
  command: number;
  fieldType: number;
  minLength: number;
  maxLength: number;
  buffer: string;
}

/** A biblioteca nativa, como o Desktop/Conector a expõe (o simulador implementa o mesmo). */
export interface CliSiTefLib {
  configure(config: CliSiTefConfig): Promise<number>;
  start(call: {
    modality: number;
    amount: string;
    receipt: string;
    date: string;
    time: string;
    operator: string;
    extra: string;
  }): Promise<number>;
  /** `answer` responde ao comando anterior; `abort` interrompe a coleta em andamento. */
  continue(answer: { buffer: string; abort: boolean }): Promise<CliSiTefContinue>;
  finish(call: { confirm: boolean; receipt: string; date: string; time: string }): Promise<void>;
}

/** Quando não há biblioteca (computador sem o CliSiTef): tudo vira "falta configurar". */
export class MissingCliSiTefLib implements CliSiTefLib {
  private fail(): never {
    throw new TefError(
      'A biblioteca do SiTef (CliSiTef) ainda não está instalada neste computador. Falta configurar.',
      'not_configured',
    );
  }
  configure(): Promise<number> {
    return this.fail();
  }
  start(): Promise<number> {
    return this.fail();
  }
  continue(): Promise<CliSiTefContinue> {
    return this.fail();
  }
  finish(): Promise<void> {
    return this.fail();
  }
}

/** Valor para o SiTef: reais com vírgula e duas casas (ex.: 1234,56). */
export function sitefAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

/** Data (aaaammdd) e hora (hhmmss) no horário de Brasília, como o SiTef pede. */
export function sitefDateTime(now: Date): { date: string; time: string } {
  const brt = new Date(now.getTime() - 3 * 3_600_000);
  return {
    date: `${brt.getUTCFullYear()}${pad(brt.getUTCMonth() + 1)}${pad(brt.getUTCDate())}`,
    time: `${pad(brt.getUTCHours())}${pad(brt.getUTCMinutes())}${pad(brt.getUTCSeconds())}`,
  };
}

/** "1:Crédito;2:Débito;" vira opções da tela. */
export function parseSitefMenu(buffer: string): { value: string; label: string }[] {
  return buffer
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(':');
      return at < 0
        ? { value: part, label: part }
        : { value: part.slice(0, at).trim(), label: part.slice(at + 1).trim() };
    });
}

const lines = (text: string | undefined) =>
  text ? text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')) : [];

interface Pending {
  receipt: string;
  date: string;
  time: string;
}

export class CliSiTefDriver implements TefDriver {
  readonly id = 'sitef';
  private configured = false;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly lib: CliSiTefLib,
    private readonly config: CliSiTefConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ensureConfigured() {
    if (this.configured) return;
    if (!this.config.host || !this.config.storeCode || !this.config.terminalId) {
      throw new TefError(
        'Falta configurar o SiTef: servidor, código da loja e número do terminal.',
        'not_configured',
      );
    }
    const ret = await this.lib.configure(this.config);
    if (ret !== 0) {
      throw new TefError(
        `O SiTef recusou a configuração (código ${ret}). Confira servidor, loja e terminal.`,
        'rejected',
      );
    }
    this.configured = true;
  }

  async begin(operation: TefOperation): Promise<TefSession> {
    await this.ensureConfigured();
    return new CliSiTefSession(this.lib, this.config, operation, this.now(), (id, p) =>
      this.pending.set(id, p),
    );
  }

  async finish(transactionId: string, confirmed: boolean): Promise<void> {
    const p = this.pending.get(transactionId);
    if (!p) return; // já fechada: confirmar duas vezes não estraga
    this.pending.delete(transactionId);
    await this.lib.finish({ confirm: confirmed, ...p });
  }
}

class CliSiTefSession implements TefSession {
  private started = false;
  private closed = false;
  private last: CliSiTefContinue | null = null;
  private lastMessage = '';
  private readonly fields = new Map<number, string>();
  private readonly stamp: Pending;

  constructor(
    private readonly lib: CliSiTefLib,
    private readonly config: CliSiTefConfig,
    private readonly operation: TefOperation,
    now: Date,
    private readonly remember: (id: string, pending: Pending) => void,
  ) {
    const { date, time } = sitefDateTime(now);
    const receipt = (
      operation.kind === 'sale' ? operation.saleId.replace(/\W/g, '') : 'cancelamento'
    ).slice(-12);
    this.stamp = { receipt: receipt || '0', date, time };
  }

  async abort(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.started) await this.lib.continue({ buffer: '', abort: true }).catch(() => undefined);
  }

  private modality(): number {
    const m = this.config.modalities;
    if (this.operation.kind === 'cancel') return m?.cancel ?? 0;
    return m?.[this.operation.method] ?? 0;
  }

  async next(reply?: TefReply): Promise<TefStep> {
    if (this.closed) return { kind: 'done', result: declined('Operação encerrada.') };
    let res: CliSiTefContinue;
    if (!this.started) {
      this.started = true;
      const ret = await this.lib.start({
        modality: this.modality(),
        amount: sitefAmount(this.operation.amountCents),
        receipt: this.stamp.receipt,
        date: this.stamp.date,
        time: this.stamp.time,
        operator: this.operation.operator ?? '',
        extra: this.config.extra ?? '',
      });
      if (ret !== SITEF_CONTINUE) return this.finishWith(ret);
      res = await this.lib.continue({ buffer: '', abort: false });
    } else if (reply?.kind === 'cancel') {
      res = await this.lib.continue({ buffer: '', abort: true });
    } else {
      res = await this.lib.continue({ buffer: this.answerFor(reply), abort: false });
    }
    return this.step(res);
  }

  /** O que o SiTef espera como resposta ao último comando. */
  private answerFor(reply: TefReply | undefined): string {
    const command = this.last?.command;
    if (command === SITEF_COMMAND.confirm) {
      // Documentação do CliSiTef: 0 = sim, 1 = não (a conferir na homologação, E10).
      return reply?.kind === 'yes' ? '0' : '1';
    }
    if (reply?.kind === 'value') return reply.value;
    return '';
  }

  private async step(first: CliSiTefContinue): Promise<TefStep> {
    let res = first;
    // Comandos que só informam (campo devolvido, limpar visor) não aparecem para o operador.
    for (let i = 0; i < 500; i++) {
      this.last = res;
      if (res.ret !== SITEF_CONTINUE) return this.finishWith(res.ret);
      const c = SITEF_COMMAND;
      switch (res.command) {
        case c.fieldResult:
          this.fields.set(res.fieldType, res.buffer);
          break;
        case c.messageOperator:
        case c.messageCustomer:
        case c.messageBoth: {
          this.lastMessage = res.buffer;
          const target =
            res.command === c.messageOperator
              ? 'operator'
              : res.command === c.messageCustomer
                ? 'customer'
                : 'both';
          return { kind: 'message', target, text: res.buffer };
        }
        case c.pause:
          this.lastMessage = res.buffer;
          return { kind: 'wait', text: res.buffer };
        case c.menu:
          return { kind: 'menu', title: this.menuTitle, options: parseSitefMenu(res.buffer) };
        case c.confirm:
          return { kind: 'confirm', question: res.buffer };
        case c.collectField:
        case c.collectMoney:
        case c.collectSensitive:
          return {
            kind: 'input',
            title: res.buffer,
            format: res.command === c.collectMoney ? 'money' : 'text',
            minLength: res.minLength,
            maxLength: res.maxLength,
            secret: res.command === c.collectSensitive,
          };
        case c.menuTitle:
          this.menuTitle = res.buffer;
          break;
        case c.header:
        case c.clearOperator:
        case c.clearCustomer:
        case c.clearBoth:
        case c.clearMenuTitle:
        case c.clearHeader:
          break;
        case c.checkInterrupt:
          // Nenhuma interrupção pendente: o cancelamento do operador chega pelo `abort`.
          break;
        default:
          await this.abort();
          throw new TefError(
            `O SiTef pediu um comando que o Bipaê ainda não trata (${res.command}). A operação foi cancelada.`,
            'protocol',
          );
      }
      res = await this.lib.continue({ buffer: '', abort: false });
    }
    await this.abort();
    throw new TefError('O SiTef não terminou a operação. Tente de novo.', 'protocol');
  }

  private menuTitle = '';

  private finishWith(ret: number): TefStep {
    this.closed = true;
    if (ret === 0) {
      const id = `${this.stamp.receipt}-${this.stamp.date}-${this.stamp.time}`;
      this.remember(id, this.stamp);
      const result: TefTransactionResult = {
        approved: true,
        message: 'Aprovada',
        transactionId: id,
        ...(this.fields.get(SITEF_FIELD.nsuSitef) && {
          nsu: this.fields.get(SITEF_FIELD.nsuSitef),
        }),
        ...(this.fields.get(SITEF_FIELD.nsuHost) && {
          hostNsu: this.fields.get(SITEF_FIELD.nsuHost),
        }),
        ...(this.fields.get(SITEF_FIELD.authorizationCode) && {
          authorizationCode: this.fields.get(SITEF_FIELD.authorizationCode),
        }),
        receipts: {
          customer: lines(this.fields.get(SITEF_FIELD.customerReceipt)),
          merchant: lines(this.fields.get(SITEF_FIELD.merchantReceipt)),
        },
      };
      return { kind: 'done', result };
    }
    if (ret === SITEF_CANCELLED_BY_OPERATOR) {
      return { kind: 'done', result: declined('Operação cancelada pelo operador.') };
    }
    if (ret === SITEF_CANCELLED_BY_CUSTOMER) {
      return { kind: 'done', result: declined('Operação cancelada pelo cliente no pinpad.') };
    }
    if (ret === SITEF_NO_HOST) {
      throw new TefError(
        'Sem comunicação com o SiTef. Confira a rede e o servidor; a venda segue sem cartão.',
        'unavailable',
      );
    }
    return {
      kind: 'done',
      result: declined(this.lastMessage || `Transação não aprovada (código ${ret}).`),
    };
  }
}
