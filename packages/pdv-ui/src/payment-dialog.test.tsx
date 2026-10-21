import type { PixChargeView } from '@bipae/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaymentDialog } from './dialogs';

/** F8-08 e F8-09: cartão na maquininha à parte, Pix pela API do banco e a reserva sem internet. */

const charge = (status: PixChargeView['status']): PixChargeView => ({
  txid: '0192abcd0000700080000000000000aa',
  amountCents: 1890,
  copyPaste: '00020126580014br.gov.bcb.pix-simulado6304ABCD',
  status,
  endToEndId: status === 'paid' ? 'E00000000202610211200abcdefghijk' : null,
  message: null,
});

describe('pagamento no caixa', () => {
  it('Pix pela API: mostra o QR do banco e entra sozinho quando o banco confirma', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onPaid = vi.fn(async () => {});
    const get = vi.fn().mockResolvedValueOnce(charge('pending')).mockResolvedValue(charge('paid'));
    render(
      <PaymentDialog
        totalCents={1890}
        payments={{ card: 'manual', pix: 'api' }}
        pixApi={{ create: async () => charge('pending'), get }}
        onPaid={onPaid}
        onClose={() => {}}
      />,
    );
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('radio', { name: 'Pix' }));
    await user.click(screen.getByRole('button', { name: 'Adicionar pix' }));
    expect(await screen.findByRole('img', { name: 'QR Code do Pix de R$ 18,90' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeDisabled();
    await vi.advanceTimersByTimeAsync(7000);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Finalizar venda' }));
    expect(onPaid).toHaveBeenCalledWith([
      expect.objectContaining({
        method: 'pix',
        receivedCents: 1890,
        provider: 'Pix (API do banco)',
        nsu: 'E00000000202610211200abcdefghijk',
      }),
    ]);
    vi.useRealTimers();
  });

  it('sem resposta do banco, cai para o QR da loja e o operador confirma', async () => {
    render(
      <PaymentDialog
        totalCents={1890}
        payments={{
          card: 'manual',
          pix: 'api',
          pixStatic: { key: 'loja@exemplo.com.br', merchantName: 'Loja', city: 'Curitiba' },
        }}
        pixApi={{
          create: async () => {
            throw new Error('Sem internet.');
          },
          get: async () => charge('pending'),
        }}
        onPaid={async () => {}}
        onClose={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Pix' }));
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar pix' }));
    expect(await screen.findByText(/Use o QR da loja e confirme quando cair/)).toBeVisible();
    expect(screen.getByRole('img', { name: 'QR Code do Pix de R$ 18,90' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Pagamento recebido' }));
    expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeEnabled();
  });

  it('cartão sem integração não aprova sozinho: espera o operador confirmar', async () => {
    const onPaid = vi.fn(async () => {});
    render(<PaymentDialog totalCents={5000} onPaid={onPaid} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Cartão de crédito' }));
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar cartão de crédito' }));
    expect(screen.getByRole('button', { name: 'Finalizar venda' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Código da transação (NSU), opcional'), '777');
    await userEvent.click(screen.getByRole('button', { name: 'Aprovado na maquininha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar venda' }));
    expect(onPaid).toHaveBeenCalledWith([
      expect.objectContaining({ method: 'credit', provider: 'Maquininha à parte', nsu: '777' }),
    ]);
  });
});
