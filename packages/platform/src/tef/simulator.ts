import {
  SITEF_CANCELLED_BY_OPERATOR,
  SITEF_COMMAND,
  SITEF_CONTINUE,
  SITEF_FIELD,
  SITEF_NO_HOST,
  type CliSiTefConfig,
  type CliSiTefContinue,
  type CliSiTefLib,
} from './cli-sitef';

/**
 * Pinpad e SiTef de mentira (F8-11): cumpre o mesmo roteiro do CliSiTef sem hardware nem conta.
 * Regras de teste, pelos centavos do valor: terminados em 13 são negados pelo emissor; em 99,
 * o SiTef fica fora do ar. Sem modalidade definida, pergunta crédito ou débito, como o SiTef faz.
 */
export class SimulatedCliSiTefLib implements CliSiTefLib {
  /** Transações confirmadas e desfeitas, para os testes conferirem a segunda fase. */
  readonly finished: { confirm: boolean; receipt: string }[] = [];
  /** Chamadas a `continue`, para provar que o laço andou. */
  calls = 0;
  private queue: CliSiTefContinue[] = [];
  private nsu = 0;
  private lastCommand = -1;
  private chosen = '';

  constructor(private readonly options: { configureReturns?: number } = {}) {}

  async configure(_config: CliSiTefConfig): Promise<number> {
    return this.options.configureReturns ?? 0;
  }

  private cmd(command: number, buffer: string, extra: Partial<CliSiTefContinue> = {}) {
    return {
      ret: SITEF_CONTINUE,
      command,
      fieldType: -1,
      minLength: 0,
      maxLength: 0,
      buffer,
      ...extra,
    } satisfies CliSiTefContinue;
  }

  private end(ret: number): CliSiTefContinue {
    return { ret, command: 0, fieldType: 0, minLength: 0, maxLength: 0, buffer: '' };
  }

  async start(call: { modality: number; amount: string }): Promise<number> {
    const cents = Number(call.amount.replace(',', '').replace('-', ''));
    this.queue = [];
    this.chosen = '';
    const c = SITEF_COMMAND;
    this.queue.push(this.cmd(c.messageBoth, 'Insira, passe ou aproxime o cartão'));
    if (call.modality === 0) {
      this.queue.push(this.cmd(c.menuTitle, 'Forma de pagamento'));
      this.queue.push(this.cmd(c.menu, '1:Cartão de crédito;2:Cartão de débito;'));
    }
    this.queue.push(this.cmd(c.messageCustomer, 'Digite a senha no pinpad'));
    if (cents % 100 === 99) {
      this.queue.push(this.end(SITEF_NO_HOST));
      return SITEF_CONTINUE;
    }
    if (cents % 100 === 13) {
      this.queue.push(this.cmd(c.messageBoth, 'Transação negada pelo emissor (simulador)'));
      this.queue.push(this.end(1));
      return SITEF_CONTINUE;
    }
    const nsu = String(++this.nsu).padStart(6, '0');
    const field = (fieldType: number, buffer: string) =>
      this.cmd(c.fieldResult, buffer, { fieldType });
    this.queue.push(
      field(SITEF_FIELD.nsuSitef, nsu),
      field(SITEF_FIELD.nsuHost, `H${nsu}`),
      field(SITEF_FIELD.authorizationCode, `SIM${nsu}`),
      field(
        SITEF_FIELD.customerReceipt,
        ['MERCADINHO DE TESTE', 'VIA CLIENTE', `VALOR R$ ${call.amount}`, `NSU ${nsu}`].join(
          '\r\n',
        ),
      ),
      field(
        SITEF_FIELD.merchantReceipt,
        [
          'MERCADINHO DE TESTE',
          'VIA ESTABELECIMENTO',
          `VALOR R$ ${call.amount}`,
          `NSU ${nsu}`,
        ].join('\r\n'),
      ),
      this.end(0),
    );
    return SITEF_CONTINUE;
  }

  async continue(answer: { buffer: string; abort: boolean }): Promise<CliSiTefContinue> {
    this.calls++;
    if (answer.abort) {
      this.queue = [];
      return this.end(SITEF_CANCELLED_BY_OPERATOR);
    }
    if (this.lastCommand === SITEF_COMMAND.menu) this.chosen = answer.buffer;
    const next = this.queue.shift() ?? this.end(-1);
    this.lastCommand = next.command;
    return next;
  }

  /** Opção escolhida no menu do pinpad, para os testes. */
  get menuChoice() {
    return this.chosen;
  }

  async finish(call: { confirm: boolean; receipt: string }): Promise<void> {
    this.finished.push({ confirm: call.confirm, receipt: call.receipt });
  }
}
