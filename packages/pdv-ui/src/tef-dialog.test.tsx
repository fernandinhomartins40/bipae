import { createTefDriver, type TefDriver } from '@bipae/platform';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentDialog } from './dialogs';

/** F8-11.b: cartão pelo TEF com pinpad simulado, passos na tela e as duas fases. */

function spyDriver(): { driver: TefDriver; finished: [string, boolean][] } {
  const inner = createTefDriver({ provider: 'simulator' }, {})!;
  const finished: [string, boolean][] = [];
  return {
    finished,
    driver: {
      id: inner.id,
      begin: (op) => inner.begin(op),
      finish: async (id, ok) => {
        finished.push([id, ok]);
        await inner.finish(id, ok);
      },
    },
  };
}

async function approveOnPinpad(
  totalCents: number,
  driver: TefDriver,
  onPaid = vi.fn(async () => {}),
) {
  const onReceipts = vi.fn();
  const user = userEvent.setup();
  const view = render(
    <PaymentDialog
      totalCents={totalCents}
      tef={{ driver, onReceipts }}
      onPaid={onPaid}
      onClose={() => {}}
    />,
  );
  await user.click(screen.getByRole('radio', { name: 'Cartão de crédito' }));
  await user.click(screen.getByRole('button', { name: 'Adicionar cartão de crédito' }));
  // O simulador pergunta a forma de pagamento, como o SiTef faz sem modalidade.
  await user.click(await screen.findByRole('button', { name: 'Cartão de crédito' }));
  return { user, onPaid, onReceipts, view };
}

describe('pagamento no caixa com TEF (F8-11.b)', () => {
  it('mostra os passos do pinpad, aprova, imprime recibos e confirma depois da venda gravada', async () => {
    const { driver, finished } = spyDriver();
    const { user, onPaid, onReceipts } = await approveOnPinpad(2500, driver);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeEnabled(),
    );
    expect(onReceipts).toHaveBeenCalledWith(expect.arrayContaining(['VIA CLIENTE']));
    expect(finished).toEqual([]); // ainda pendente: a venda não foi gravada
    await user.click(screen.getByRole('button', { name: 'Finalizar venda' }));
    expect(onPaid).toHaveBeenCalledWith([
      expect.objectContaining({ method: 'credit', receivedCents: 2500, nsu: '000001' }),
    ]);
    await waitFor(() => expect(finished).toHaveLength(1));
    expect(finished[0]![1]).toBe(true);
  });

  it('"Refazer pagamentos" desfaz a transação aprovada no pinpad', async () => {
    const { driver, finished } = spyDriver();
    const { user } = await approveOnPinpad(2500, driver);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refazer pagamentos' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Refazer pagamentos' }));
    await waitFor(() => expect(finished).toHaveLength(1));
    expect(finished[0]![1]).toBe(false);
  });

  it('fechar o diálogo sem finalizar desfaz o que o pinpad aprovou', async () => {
    const { driver, finished } = spyDriver();
    const { view } = await approveOnPinpad(2500, driver);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeEnabled(),
    );
    view.unmount();
    await waitFor(() => expect(finished).toEqual([[expect.any(String), false]]));
  });

  it('transação negada mostra a mensagem e não adiciona pagamento', async () => {
    const { driver } = spyDriver();
    await approveOnPinpad(2513, driver);
    expect(await screen.findByText(/negada pelo emissor/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeDisabled();
  });

  it('o operador cancela no menu do pinpad e nada é cobrado', async () => {
    const { driver } = spyDriver();
    const user = userEvent.setup();
    render(
      <PaymentDialog
        totalCents={1000}
        tef={{ driver }}
        onPaid={async () => {}}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole('radio', { name: 'Cartão de crédito' }));
    await user.click(screen.getByRole('button', { name: 'Adicionar cartão de crédito' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Operação cancelada pelo operador.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeDisabled();
  });
});
