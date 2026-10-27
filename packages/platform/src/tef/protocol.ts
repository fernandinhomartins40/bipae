/**
 * TEF com pinpad (F8-11, ADR-0018). O TEF conversa com o operador em etapas: mostra mensagens,
 * pergunta uma opção, pede um campo, aguarda o cartão no pinpad e, no fim, devolve o resultado.
 * Este arquivo é a especificação em TypeScript puro, igual para o SiTef, o PayGo e o simulador:
 * o código nativo (DLL, Rust) só move chamadas e bytes; a regra do fluxo mora aqui.
 *
 * Duas fases, como em todo TEF: depois de aprovada, a transação fica pendente até o caixa
 * confirmar que a venda foi gravada (`finish(..., true)`). Se a venda não for gravada, desfaz-se
 * (`finish(..., false)`) e o cliente não é cobrado.
 */

export type TefMethod = 'credit' | 'debit' | 'voucher' | 'pix';

/** O que o caixa pede ao TEF. */
export type TefOperation =
  | {
      kind: 'sale';
      amountCents: number;
      method: TefMethod;
      installments?: number;
      /** Venda que está sendo paga (vai como número do cupom). */
      saleId: string;
      operator?: string;
    }
  | {
      kind: 'cancel';
      amountCents: number;
      /** NSU do host da transação original. */
      nsu: string;
      /** Data da transação original, aaaa-mm-dd. */
      originalDate: string;
      operator?: string;
    };

/** Recibos em linhas de texto, prontos para a impressora (cliente e estabelecimento). */
export interface TefReceipts {
  customer: string[];
  merchant: string[];
}

export interface TefTransactionResult {
  approved: boolean;
  /** Mensagem em português para o operador. */
  message: string;
  /** Identifica a transação pendente para confirmar ou desfazer; ausente quando negada. */
  transactionId?: string;
  nsu?: string;
  hostNsu?: string;
  authorizationCode?: string;
  acquirer?: string;
  brand?: string;
  receipts: TefReceipts;
}

/** Cada passo que o TEF pede à tela do caixa. */
export type TefStep =
  /** Texto para o visor do operador e/ou do cliente; não espera resposta. */
  | { kind: 'message'; target: 'operator' | 'customer' | 'both'; text: string }
  | { kind: 'menu'; title: string; options: { value: string; label: string }[] }
  | {
      kind: 'input';
      title: string;
      /** Tipo de dado, para a tela escolher o teclado e a máscara. */
      format: 'text' | 'number' | 'money' | 'cpf' | 'cnpj' | 'date';
      minLength: number;
      maxLength: number;
      /** Esconde o que é digitado (senha, código de segurança). */
      secret: boolean;
    }
  | { kind: 'confirm'; question: string }
  /** Espera pelo pinpad (cartão, senha); a tela pode oferecer "Cancelar". */
  | { kind: 'wait'; text: string }
  | { kind: 'done'; result: TefTransactionResult };

/** Resposta da tela ao passo anterior. `cancel` é o operador desistindo. */
export type TefReply =
  | { kind: 'ok' }
  | { kind: 'value'; value: string }
  | { kind: 'yes' }
  | { kind: 'no' }
  | { kind: 'cancel' };

/** Uma conversa com o TEF, do início da operação ao resultado. */
export interface TefSession {
  /** Primeiro passo ou o seguinte, depois da resposta ao anterior. */
  next(reply?: TefReply): Promise<TefStep>;
  /** Desiste no meio (o TEF desfaz o que for preciso). */
  abort(): Promise<void>;
}

/** Erro de configuração ou de comunicação; a mensagem já vai em português para a tela. */
export class TefError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'unavailable' | 'rejected' | 'protocol',
  ) {
    super(message);
  }
}

export interface TefDriver {
  readonly id: string;
  /** Abre a conversa de uma operação. */
  begin(operation: TefOperation): Promise<TefSession>;
  /** Fecha a transação aprovada: `true` confirma a venda gravada, `false` desfaz. */
  finish(transactionId: string, confirmed: boolean): Promise<void>;
}

/** O que a tela do caixa precisa saber fazer (a tela real é React; os testes usam um roteiro). */
export interface TefUi {
  show(step: Extract<TefStep, { kind: 'message' | 'wait' }>): void;
  menu(step: Extract<TefStep, { kind: 'menu' }>): Promise<string | null>;
  input(step: Extract<TefStep, { kind: 'input' }>): Promise<string | null>;
  confirm(step: Extract<TefStep, { kind: 'confirm' }>): Promise<boolean>;
}

const MAX_STEPS = 200;

/**
 * Conduz a conversa até o resultado. Qualquer cancelamento do operador (menu ou campo devolvendo
 * `null`) desiste da operação. Um TEF que não termina em 200 passos é tratado como defeito.
 */
export async function runTef(session: TefSession, ui: TefUi): Promise<TefTransactionResult> {
  let reply: TefReply | undefined;
  for (let i = 0; i < MAX_STEPS; i++) {
    const step = await session.next(reply);
    switch (step.kind) {
      case 'done':
        return step.result;
      case 'message':
      case 'wait':
        ui.show(step);
        reply = { kind: 'ok' };
        break;
      case 'menu': {
        const value = await ui.menu(step);
        reply = value === null ? { kind: 'cancel' } : { kind: 'value', value };
        break;
      }
      case 'input': {
        const value = await ui.input(step);
        reply = value === null ? { kind: 'cancel' } : { kind: 'value', value };
        break;
      }
      case 'confirm':
        reply = (await ui.confirm(step)) ? { kind: 'yes' } : { kind: 'no' };
        break;
    }
  }
  await session.abort();
  throw new TefError('O TEF não terminou a operação. Tente de novo.', 'protocol');
}

/** Transação negada ou cancelada, sem recibo. */
export function declined(message: string): TefTransactionResult {
  return { approved: false, message, receipts: { customer: [], merchant: [] } };
}
