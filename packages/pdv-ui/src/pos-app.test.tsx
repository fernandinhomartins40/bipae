import { uuidv7, type SyncPullResult, type TerminalEvent } from '@bipae/domain';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { createSimulatedPlatform } from '@bipae/platform/simulators';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PosBackend } from './backend';
import { PosApp } from './index';

const terminal = {
  id: uuidv7(),
  name: 'Caixa 1',
  platform: 'web' as const,
  nfceSeries: 1,
  storeId: uuidv7(),
};
const water = {
  id: uuidv7(),
  name: 'Água Mineral 1,5L',
  sku: null,
  unit: 'UN',
  priceCents: 299,
  isWeighable: false,
  active: true,
  ncm: null,
  cest: null,
  fiscalProfileId: null,
  parentId: null,
  barcodes: ['78912342'],
  updatedAt: '2026-10-12T10:00:00.000Z',
};

function setup(permissions = ['pos.sell', 'pos.discount.above_limit']) {
  const received: TerminalEvent[] = [];
  const backend: PosBackend = {
    push: vi.fn(async (_id: string, events: TerminalEvent[]) => {
      received.push(...(events as TerminalEvent[]));
      return { accepted: events.map((e) => e.id), rejected: [] };
    }),
    pull: vi.fn(async (): Promise<SyncPullResult> => ({
      cursor: 'c1',
      products: [water],
      hasMore: false,
    })),
    listTerminals: async () => [terminal],
    createTerminal: async () => terminal,
    listStores: async () => [],
    terminalContext: async () => ({
      terminal: { ...terminal, status: 'active' },
      storeName: 'Loja',
      businessName: 'Mercadinho',
      taxId: null,
    }),
    authorize: async () => ({ userId: uuidv7(), name: 'Gerente' }),
  };
  const platform = {
    ...createSimulatedPlatform('web'),
    openLocalDatabase: async () => nodeSqliteDriver(),
  };
  const user = { id: uuidv7(), name: 'Juliana', tenantId: uuidv7(), permissions };
  render(<PosApp platform={platform} backend={backend} user={user} onExit={() => {}} />);
  return { received, platform };
}

describe('PosApp', () => {
  it('links the device, opens the register, sells by barcode and syncs the events', async () => {
    const { received, platform } = setup();
    await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
    expect(await platform.preferences.get('bipae.terminalId')).toBe(terminal.id);

    await userEvent.type(
      await screen.findByLabelText('Dinheiro na gaveta para troco (R$)'),
      '50,00',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir caixa' }));
    expect(await screen.findByText('Caixa livre')).toBeInTheDocument();

    const input = screen.getByLabelText('Bipe o código ou digite o nome do produto');
    await userEvent.type(input, '2*78912342{Enter}');
    expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 5,98');

    await userEvent.keyboard('{F10}');
    await userEvent.click(await screen.findByRole('button', { name: 'R$ 10,00' }));
    expect(screen.getByText('Troco')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar venda' }));

    expect(
      await screen.findByText('Bipaê! Venda nº 1 concluída. Troco: R$ 4,02.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(received.map((e) => e.type)).toEqual(['cash_session.opened', 'sale.completed']),
    );
    expect(screen.getByTestId('sync-status')).not.toHaveTextContent('para enviar');
  });

  it('explains unknown codes and keeps the register usable', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir caixa' }));
    await userEvent.type(
      await screen.findByLabelText('Bipe o código ou digite o nome do produto'),
      '7891000315507{Enter}',
    );
    expect(
      await screen.findByText('Código 7891000315507 não encontrado. Confira ou busque pelo nome.'),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText('Bipe o código ou digite o nome do produto'),
      'agua{Enter}',
    );
    expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 2,99');
  });
});
