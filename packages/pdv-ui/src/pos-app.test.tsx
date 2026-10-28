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

function setup(
  permissions = ['pos.sell', 'pos.discount.above_limit'],
  extra: Partial<PosBackend> = {},
  catalog: SyncPullResult['products'] = [water],
) {
  const received: TerminalEvent[] = [];
  const backend: PosBackend = {
    push: vi.fn(async (_id: string, events: TerminalEvent[]) => {
      received.push(...(events as TerminalEvent[]));
      return { accepted: events.map((e) => e.id), rejected: [] };
    }),
    pull: vi.fn(async (): Promise<SyncPullResult> => ({
      cursor: 'c1',
      products: catalog,
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
    ...extra,
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

  it('primeira vez, sem caixa: um toque cria o "Caixa 1" e já abre (OP-04)', async () => {
    const createTerminal = vi.fn(async () => terminal);
    const { platform } = setup(['pos.sell', 'admin.terminals'], {
      listTerminals: async () => [],
      listStores: async () => [{ id: terminal.storeId, name: 'Loja' }],
      createTerminal,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Começar com o Caixa 1' }));
    expect(createTerminal).toHaveBeenCalledWith({
      storeId: terminal.storeId,
      name: 'Caixa 1',
      platform: 'web',
    });
    expect(await screen.findByRole('heading', { name: 'Abrir o caixa' })).toBeVisible();
    expect(await platform.preferences.get('bipae.terminalId')).toBe(terminal.id);
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

  it('cadastra no caixa um código desconhecido, com o catálogo preenchendo o nome (MF-07)', async () => {
    const catalog = [water];
    const createProduct = vi.fn(
      async (input: { name: string; barcodes: string[]; priceCents: number }) => {
        catalog.push({
          ...water,
          id: uuidv7(),
          name: input.name,
          barcodes: input.barcodes,
          priceCents: input.priceCents,
          updatedAt: new Date().toISOString(),
        });
        return { id: uuidv7() };
      },
    );
    setup(
      ['pos.sell', 'catalog.write'],
      {
        catalogLookup: async (gtin) => ({
          gtin,
          found: true,
          description: 'Açúcar União Refinado 1kg',
          brand: 'União',
          unit: 'UN',
          ncm: '17019900',
          packs: [],
        }),
        createProduct,
      },
      catalog,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir caixa' }));
    await userEvent.type(
      await screen.findByLabelText('Bipe o código ou digite o nome do produto'),
      '7891910000197{Enter}',
    );
    expect(await screen.findByText(/Achamos no catálogo/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nome do produto')).toHaveValue('Açúcar União Refinado 1kg');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar e vender' }));
    expect(await screen.findByText('Informe o preço de venda.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Preço de venda (R$)'), '5,99');
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar e vender' }));
    await waitFor(() => expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 5,99'));
    expect(createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Açúcar União Refinado 1kg',
        barcodes: ['7891910000197'],
        priceCents: 599,
        ncm: '17019900',
      }),
    );
  });

  it('sem permissão de cadastro, segue o aviso de código não encontrado', async () => {
    const catalogLookup = vi.fn();
    setup(['pos.sell'], { catalogLookup, createProduct: vi.fn() });
    await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir caixa' }));
    await userEvent.type(
      await screen.findByLabelText('Bipe o código ou digite o nome do produto'),
      '7891910000197{Enter}',
    );
    expect(
      await screen.findByText('Código 7891910000197 não encontrado. Confira ou busque pelo nome.'),
    ).toBeInTheDocument();
    expect(catalogLookup).not.toHaveBeenCalled();
  });
});

describe('atualização entre vendas (F2-09)', () => {
  it('com o carrinho vazio oferece a versão nova e instala sem venda em andamento', async () => {
    const { platform } = setup();
    const install = vi.fn(async () => undefined);
    platform.updater = {
      check: async () => ({ version: '1.2.3', channel: 'stable' as const }),
      install,
    } as unknown as typeof platform.updater;
    await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir caixa' }));
    expect(await screen.findByText('Nova versão do Bipaê pronta')).toBeInTheDocument();

    // Com item no carrinho, o aviso some: nada de atualizar no meio da venda.
    await userEvent.type(
      screen.getByLabelText('Bipe o código ou digite o nome do produto'),
      '78912342{Enter}',
    );
    expect(screen.queryByText('Nova versão do Bipaê pronta')).not.toBeInTheDocument();
    vi.stubGlobal('confirm', () => true);
    await userEvent.keyboard('{F12}');
    vi.unstubAllGlobals();
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar agora' }));
    expect(install).toHaveBeenCalledWith({ saleInProgress: false });
  });
});
