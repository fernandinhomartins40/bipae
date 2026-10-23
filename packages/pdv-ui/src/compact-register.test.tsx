import { uuidv7, type SyncPullResult, type TerminalEvent } from '@bipae/domain';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { createSimulatedPlatform } from '@bipae/platform/simulators';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMPACT_QUERY, useAppViewport, useCompactLayout } from './app-screen';
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

/** Simula a tela do celular: a consulta do layout compacto responde que sim. */
function phoneScreen(matches = true) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === COMPACT_QUERY ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function setup() {
  const backend: PosBackend = {
    push: vi.fn(async (_id: string, events: TerminalEvent[]) => ({
      accepted: events.map((e) => e.id),
      rejected: [],
    })),
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
  const user = {
    id: uuidv7(),
    name: 'Juliana',
    tenantId: uuidv7(),
    permissions: ['pos.sell', 'pos.discount.above_limit'],
  };
  const onExit = vi.fn();
  render(<PosApp platform={platform} backend={backend} user={user} onExit={onExit} />);
  return { onExit };
}

async function openRegister() {
  await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Abrir caixa' }));
  expect(await screen.findByText('Caixa livre')).toBeInTheDocument();
}

describe('caixa no celular (F8-14)', () => {
  beforeEach(() => phoneScreen());
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
  });

  it('usa o layout de app: topo compacto, total e Pagar embaixo, sem os atalhos do teclado', async () => {
    setup();
    await openRegister();
    expect(document.querySelector('[data-layout="compact"]')).not.toBeNull();
    // Nada do layout do computador: nem a tabela, nem o rodapé de atalhos, nem o total lateral.
    expect(screen.queryByRole('contentinfo', { name: 'Atalhos do teclado' })).toBeNull();
    expect(screen.queryByTestId('pdv-total')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByTestId('pdv-operator')).toHaveTextContent('Juliana');

    await userEvent.type(
      screen.getByLabelText('Bipe o código ou digite o nome do produto'),
      '2*78912342{Enter}',
    );
    const bar = screen.getByRole('region', { name: 'Total e pagamento' });
    expect(within(bar).getByTestId('pdv-total-mobile')).toHaveTextContent('R$ 5,98');
    expect(bar).toHaveTextContent('1 item');
    // O item recém-bipado fica selecionado na lista.
    expect(screen.getByRole('button', { name: /Água Mineral/, pressed: true })).toBeInTheDocument();

    // A altura visível vira variável CSS (o teclado do celular encolhe a tela junto).
    expect(document.documentElement.style.getPropertyValue('--app-vh')).toMatch(/px$/);
  });

  it('põe as ações secundárias na folha que sobe de baixo', async () => {
    const { onExit } = setup();
    await openRegister();
    await userEvent.type(
      screen.getByLabelText('Bipe o código ou digite o nome do produto'),
      '78912342{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ações do caixa' });
    expect(within(sheet).getByRole('region', { name: /Água Mineral/ })).toBeInTheDocument();

    // Quantidade pelo toque, sem a tecla F3.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Quantidade' }));
    await userEvent.type(await screen.findByLabelText('Quantidade'), '3{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('pdv-total-mobile')).toHaveTextContent('R$ 8,97'),
    );

    // Tirar item.
    await userEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Ações do caixa' })).getByRole('button', {
        name: 'Tirar item',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('pdv-total-mobile')).toHaveTextContent('R$ 0,00'),
    );
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeDisabled();

    // Sair do caixa fica no topo, ao alcance.
    await userEvent.click(screen.getByRole('button', { name: 'Sair do caixa' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('paga pelo Pagar do rodapé', async () => {
    setup();
    await openRegister();
    await userEvent.type(
      screen.getByLabelText('Bipe o código ou digite o nome do produto'),
      '2*78912342{Enter}',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pagar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'R$ 10,00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar venda' }));
    expect(
      await screen.findByText('Bipaê! Venda nº 1 concluída. Troco: R$ 4,02.'),
    ).toBeInTheDocument();
  });
});

describe('ajudantes da tela de app', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sem matchMedia (testes, SSR), fica no layout do computador', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useCompactLayout());
    expect(result.current).toBe(false);
  });

  it('acompanha a largura da tela', () => {
    phoneScreen(true);
    expect(renderHook(() => useCompactLayout()).result.current).toBe(true);
    phoneScreen(false);
    expect(renderHook(() => useCompactLayout()).result.current).toBe(false);
  });

  it('escreve a altura visível e trava o puxar-para-atualizar só enquanto o caixa está aberto', () => {
    const root = document.documentElement;
    const { unmount } = renderHook(() => useAppViewport(true));
    expect(root.style.getPropertyValue('--app-vh')).toBe(`${window.innerHeight}px`);
    expect(root.style.overscrollBehavior).toBe('none');
    unmount();
    expect(root.style.getPropertyValue('--app-vh')).toBe('');
    expect(root.style.overscrollBehavior).toBe('');
  });
});
