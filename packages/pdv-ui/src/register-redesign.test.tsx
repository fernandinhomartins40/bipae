import { uuidv7, type SyncPullResult, type TerminalEvent } from '@bipae/domain';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { createSimulatedPlatform } from '@bipae/platform/simulators';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PosBackend } from './backend';
import { quickCash } from './dialogs';
import { PosApp } from './index';
import { productInitials } from './register-parts';
import { layoutPrefKey, SUCCESS_SOUND_PREF, TIPS_PREF } from './register-prefs';

/** F8-15: caixa redesenhado (dois modos, guia, busca com foto, pagamento visual, venda concluída). */

const terminal = {
  id: uuidv7(),
  name: 'Caixa 1',
  platform: 'web' as const,
  nfceSeries: 1,
  storeId: uuidv7(),
};
const product = (name: string, priceCents: number, category: string | null, code: string) => ({
  id: uuidv7(),
  name,
  sku: null,
  unit: 'UN',
  priceCents,
  isWeighable: false,
  active: true,
  ncm: null,
  cest: null,
  fiscalProfileId: null,
  parentId: null,
  category,
  barcodes: [code],
  updatedAt: '2026-10-12T10:00:00.000Z',
});
const CATALOG = [
  product('Água Mineral 1,5L', 299, 'Bebidas', '78912342'),
  product('Pão de Queijo', 450, 'Padaria', '78900011'),
  product('Café Coado', 500, 'Bebidas', '78900028'),
];

async function setup(prefs: Record<string, string> = {}) {
  const received: TerminalEvent[] = [];
  const backend: PosBackend = {
    push: vi.fn(async (_id: string, events: TerminalEvent[]) => {
      received.push(...events);
      return { accepted: events.map((e) => e.id), rejected: [] };
    }),
    pull: vi.fn(async (): Promise<SyncPullResult> => ({
      cursor: 'c1',
      products: CATALOG,
      hasMore: false,
    })),
    listTerminals: async () => [terminal],
    createTerminal: async () => terminal,
    listStores: async () => [],
    terminalContext: async () => ({
      terminal: { ...terminal, status: 'active' },
      storeName: 'Loja',
      businessName: 'Lanchonete',
      taxId: null,
    }),
    authorize: async () => ({ userId: uuidv7(), name: 'Gerente' }),
  };
  const platform = {
    ...createSimulatedPlatform('web'),
    openLocalDatabase: async () => nodeSqliteDriver(),
  };
  for (const [key, value] of Object.entries(prefs)) await platform.preferences.set(key, value);
  const user = {
    id: uuidv7(),
    name: 'Juliana',
    tenantId: uuidv7(),
    permissions: ['pos.sell', 'pos.discount.above_limit'],
  };
  render(<PosApp platform={platform} backend={backend} user={user} onExit={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: /Caixa 1/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Abrir caixa' }));
  expect(await screen.findByText('Caixa livre')).toBeInTheDocument();
  return { platform, received };
}

const field = () => screen.getByLabelText('Bipe o código ou digite o nome do produto');

/** Faz uma venda de R$ 2,99 em dinheiro, pagando com R$ 10,00. */
async function sellWater() {
  await userEvent.type(field(), '78912342{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Receber (F10)' }));
  await userEvent.click(await screen.findByRole('button', { name: 'R$ 10,00' }));
  await userEvent.click(screen.getByRole('button', { name: 'Finalizar venda' }));
}

afterEach(() => vi.unstubAllGlobals());

describe('dois modos de tela', () => {
  it('começa na venda em destaque, troca para a grade e guarda a escolha neste caixa', async () => {
    const { platform } = await setup({ [TIPS_PREF]: 'seen' });
    const modes = screen.getByRole('group', { name: 'Modo da tela' });
    expect(within(modes).getByRole('button', { name: 'Venda em destaque' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Na venda em destaque, o último item bipado aparece grande.
    await userEvent.type(field(), '78912342{Enter}');
    expect(screen.getByTestId('pdv-last-item')).toHaveTextContent('Água Mineral 1,5L');
    expect(screen.getByTestId('pdv-last-item')).toHaveTextContent('1 UN × R$ 2,99');

    await userEvent.click(within(modes).getByRole('button', { name: 'Grade de produtos' }));
    const tabs = await screen.findByRole('navigation', { name: 'Categorias' });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Todos', 'Bebidas', 'Padaria']);
    await waitFor(() =>
      expect(platform.preferences.get(layoutPrefKey(terminal.id))).resolves.toBe('grid'),
    );

    // A aba filtra e o toque no produto põe na venda; o cartão mostra quantos já tem.
    await userEvent.click(within(tabs).getByRole('button', { name: 'Padaria' }));
    const grid = screen.getByRole('list', { name: 'Produtos' });
    await waitFor(() => expect(within(grid).getAllByRole('button')).toHaveLength(1));
    await userEvent.click(within(grid).getByRole('button', { name: /Pão de Queijo/ }));
    await userEvent.click(within(grid).getByRole('button', { name: /Pão de Queijo/ }));
    expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 11,99');
    expect(within(grid).getByRole('button', { name: /Pão de Queijo/ })).toHaveAccessibleName(
      'Pão de Queijo, R$ 4,50, 2 na venda',
    );
  });

  it('abre na grade quando o caixa já escolheu a grade', async () => {
    await setup({ [layoutPrefKey(terminal.id)]: 'grid', [TIPS_PREF]: 'seen' });
    expect(await screen.findByRole('navigation', { name: 'Categorias' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Modo da tela' })).getByRole('button', {
        name: 'Grade de produtos',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('guia da primeira venda', () => {
  it('mostra uma dica de cada vez e some depois da primeira venda', async () => {
    const { platform } = await setup();
    expect(await screen.findByTestId('pdv-tip')).toHaveTextContent('Bipe ou digite aqui');
    await userEvent.type(field(), '78912342{Enter}');
    expect(screen.getByTestId('pdv-tip')).toHaveTextContent('Toque para receber');
    await userEvent.click(screen.getByRole('button', { name: 'Receber (F10)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'R$ 10,00' }));
    await userEvent.click(screen.getByRole('button', { name: 'Finalizar venda' }));
    await screen.findByTestId('sale-success');
    expect(screen.queryByTestId('pdv-tip')).toBeNull();
    await waitFor(() => expect(platform.preferences.get(TIPS_PREF)).resolves.toBe('seen'));
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Caixa livre')).toBeInTheDocument();
    expect(screen.queryByTestId('pdv-tip')).toBeNull();
  });

  it('"Pular dicas" esconde e não mostra mais', async () => {
    const { platform } = await setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Pular dicas' }));
    expect(screen.queryByTestId('pdv-tip')).toBeNull();
    await waitFor(() => expect(platform.preferences.get(TIPS_PREF)).resolves.toBe('seen'));
    await userEvent.type(field(), '78912342{Enter}');
    expect(screen.queryByTestId('pdv-tip')).toBeNull();
  });

  it('quem já viu não vê as dicas', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    expect(screen.queryByTestId('pdv-tip')).toBeNull();
  });
});

describe('busca por nome com foto', () => {
  it('mostra os produtos enquanto digita, com iniciais e preço, e o toque põe na venda', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    await userEvent.type(field(), 'caf');
    const results = await screen.findByRole('list', { name: 'Resultados da busca' });
    const card = within(results).getByRole('button', { name: /Café Coado/ });
    expect(card).toHaveTextContent('CC');
    expect(card).toHaveTextContent('R$ 5,00');
    await userEvent.click(card);
    expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 5,00');
    expect(screen.queryByRole('list', { name: 'Resultados da busca' })).toBeNull();
    expect(field()).toHaveValue('');
  });

  it('respeita o "3*" digitado antes do nome', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    await userEvent.type(field(), '3*pão');
    const results = await screen.findByRole('list', { name: 'Resultados da busca' });
    await userEvent.click(within(results).getByRole('button', { name: /Pão de Queijo/ }));
    expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 13,50');
  });

  it('não busca enquanto o leitor digita números de um código', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    await userEvent.type(field(), '7891');
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('list', { name: 'Resultados da busca' })).toBeNull();
  });

  it('iniciais: as duas primeiras palavras com letra', () => {
    expect(productInitials('Água Mineral 1,5L')).toBe('ÁM');
    expect(productInitials('1kg Arroz')).toBe('AR');
    expect(productInitials('Coxinha')).toBe('CO');
  });
});

describe('pagamento visual', () => {
  it('formas em cartões com tecla, notas rápidas e o troco antes de confirmar', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    await userEvent.type(field(), '78912342{Enter}');
    await userEvent.keyboard('{F10}');
    const methods = await screen.findByRole('radiogroup', { name: 'Forma de pagamento' });
    expect(
      within(methods)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual([
      'Dinheiro',
      'Pix',
      'Cartão de débito',
      'Cartão de crédito',
      'Vale-refeição/alimentação',
      'Crediário',
    ]);
    expect(within(methods).getByRole('radio', { name: 'Crediário' })).toHaveTextContent('fiado');
    // Notas de R$ 50 e R$ 100 sempre à mão.
    const notes = screen.getByRole('group', { name: 'Notas rápidas' });
    expect(within(notes).getByRole('button', { name: 'R$ 50,00' })).toBeInTheDocument();
    expect(within(notes).getByRole('button', { name: 'R$ 100,00' })).toBeInTheDocument();

    // A letra escolhe a forma, com o foco no valor.
    const amount = screen.getByLabelText('Valor recebido (R$)');
    await userEvent.type(amount, 'p');
    expect(within(methods).getByRole('radio', { name: 'Pix' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.type(screen.getByLabelText('Valor (R$)'), 'd');
    expect(within(methods).getByRole('radio', { name: 'Dinheiro' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // O troco aparece grande enquanto se digita o valor recebido.
    await userEvent.clear(screen.getByLabelText('Valor recebido (R$)'));
    await userEvent.type(screen.getByLabelText('Valor recebido (R$)'), '20,00');
    expect(screen.getByTestId('payment-change')).toHaveTextContent('R$ 17,01');
  });

  it('notas rápidas: o valor certo, os arredondamentos e as notas de 50 e 100', () => {
    expect(quickCash(598)).toEqual([598, 600, 1000, 2000, 5000, 10000]);
    expect(quickCash(5000)).toEqual([5000, 6000, 10000, 20000]);
    expect(quickCash(23450)).toEqual([5000, 10000, 23450, 23500, 23600, 24000]);
  });
});

describe('venda concluída', () => {
  it('mostra o troco gigante e o Enter segue para a próxima venda', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    await sellWater();
    const success = await screen.findByTestId('sale-success');
    expect(within(success).getByRole('heading', { name: 'Venda nº 1 concluída!' })).toBeVisible();
    expect(within(success).getByTestId('sale-change')).toHaveTextContent('R$ 7,01');
    expect(success).toHaveAttribute('data-motion', 'on');
    expect(within(success).getByText('Bipaê! Venda nº 1 concluída. Troco: R$ 7,01.')).toBeVisible();
    expect(field()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByTestId('sale-success')).toBeNull();
    expect(screen.getByText('Caixa livre')).toBeInTheDocument();
  });

  it('bipar o próximo produto já começa a venda seguinte', async () => {
    await setup({ [TIPS_PREF]: 'seen' });
    await sellWater();
    await screen.findByTestId('sale-success');
    await userEvent.type(field(), '78900011{Enter}');
    expect(screen.queryByTestId('sale-success')).toBeNull();
    expect(screen.getByTestId('pdv-total')).toHaveTextContent('R$ 4,50');
  });

  it('com "reduzir movimento", nada se mexe; o som fica desligado até ligar', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { platform } = await setup({ [TIPS_PREF]: 'seen' });
    await sellWater();
    const success = await screen.findByTestId('sale-success');
    expect(success).toHaveAttribute('data-motion', 'off');
    expect(success.querySelector('.bipae-pop, .bipae-draw, .bipae-rise')).toBeNull();
    const sound = within(success).getByRole('button', { name: 'Som de venda concluída' });
    expect(sound).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(sound);
    expect(sound).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(platform.preferences.get(SUCCESS_SOUND_PREF)).resolves.toBe('on'));
    await userEvent.click(within(success).getByRole('button', { name: 'Próxima venda' }));
    expect(screen.queryByTestId('sale-success')).toBeNull();
  });
});
