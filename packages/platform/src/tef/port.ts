import type { TefPort, TefRequest, TefResult } from '../ports';
import {
  runTef,
  TefError,
  type TefDriver,
  type TefTransactionResult,
  type TefUi,
} from './protocol';

function toResult(result: TefTransactionResult, acquirer: string): TefResult {
  return {
    approved: result.approved,
    message: result.message,
    ...(result.nsu && { nsu: result.nsu }),
    ...(result.authorizationCode && { authorizationCode: result.authorizationCode }),
    ...(result.transactionId && { transactionId: result.transactionId }),
    ...(result.brand && { brand: result.brand }),
    acquirer: result.acquirer ?? acquirer,
    receipts: result.receipts,
  };
}

/**
 * Liga um `TefDriver` (SiTef, PayGo, simulador) à porta `TefPort` que o caixa usa. A tela do
 * caixa entra como `TefUi`. Erros de configuração ou de rede viram uma resposta negada com a
 * mensagem em português: o TEF jamais derruba a venda, o caixa segue com outra forma de pagamento.
 */
export class DriverTefPort implements TefPort {
  constructor(
    private readonly driver: TefDriver,
    private readonly ui: TefUi,
    private readonly acquirer = 'TEF',
  ) {}

  private async run(operation: Parameters<TefDriver['begin']>[0]): Promise<TefResult> {
    try {
      const session = await this.driver.begin(operation);
      return toResult(await runTef(session, this.ui), this.acquirer);
    } catch (error) {
      if (error instanceof TefError) {
        return {
          approved: false,
          message: error.message,
          receipts: { customer: [], merchant: [] },
        };
      }
      throw error;
    }
  }

  pay(request: TefRequest): Promise<TefResult> {
    return this.run({
      kind: 'sale',
      amountCents: request.amountCents,
      method: request.method,
      ...(request.installments && { installments: request.installments }),
      saleId: request.saleId,
    });
  }

  cancel(
    nsu: string,
    original?: { amountCents: number; originalDate: string },
  ): Promise<TefResult> {
    if (!original) {
      return Promise.resolve({
        approved: false,
        message: 'Para cancelar no TEF, informe o valor e a data da venda original.',
      });
    }
    return this.run({ kind: 'cancel', nsu, ...original });
  }

  async finish(transactionId: string, confirmed: boolean): Promise<void> {
    await this.driver.finish(transactionId, confirmed);
  }
}
