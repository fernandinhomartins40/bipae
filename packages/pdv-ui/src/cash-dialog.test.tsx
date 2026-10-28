import type { PdvService } from '@bipae/pdv-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CashDialog } from './dialogs';

/** PIE R2-11: sangria sem duplo envio e fechamento com revisão. */

function abrir(pdv: Partial<PdvService>, onClosed = vi.fn()) {
  render(
    <CashDialog
      pdv={pdv as PdvService}
      canWithdraw
      requestAuthorization={async () => null}
      onClosed={onClosed}
      onClose={() => {}}
    />,
  );
  return { onClosed, user: userEvent.setup() };
}

describe('menu do caixa', () => {
  it('dois Enter seguidos registram uma sangria só', async () => {
    let soltar = () => undefined as void;
    const addMovement = vi.fn(
      () =>
        new Promise<string>((ok) => {
          soltar = () => ok('mov-1');
        }),
    );
    const { user } = abrir({ addMovement });
    await user.click(screen.getByRole('button', { name: 'Sangria (retirar dinheiro)' }));
    await user.type(screen.getByLabelText('Valor (R$)'), '50,00');
    await user.keyboard('{Enter}{Enter}');
    soltar();
    expect(await screen.findByText(/Sangria de R\$\s50,00 registrado/)).toBeVisible();
    expect(addMovement).toHaveBeenCalledTimes(1);
  });

  it('fechamento pede o dinheiro e mostra a revisão antes de fechar', async () => {
    const closeSession = vi.fn(async () => ({}) as Awaited<ReturnType<PdvService['closeSession']>>);
    const { user, onClosed } = abrir({ closeSession });
    await user.click(screen.getByRole('button', { name: 'Fechar o caixa' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }));
    expect(screen.getByText('Informe quanto há em dinheiro na gaveta (pode ser 0).')).toBeVisible();
    expect(closeSession).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Dinheiro (R$)'), '100,00');
    await user.click(screen.getByRole('button', { name: 'Confirmar fechamento' }));
    const revisao = screen.getByRole('list', { name: 'Valores contados' });
    expect(revisao).toHaveTextContent('Dinheiro');
    expect(revisao).toHaveTextContent('não informado');
    expect(closeSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Fechar o caixa agora' }));
    await waitFor(() => expect(onClosed).toHaveBeenCalled());
    expect(closeSession).toHaveBeenCalledWith({ cash: 10000 });
  });
});
