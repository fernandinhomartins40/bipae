import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  applyDisplayPreferences,
  Button,
  DataTable,
  DEFAULT_DISPLAY,
  EmptyState,
  FilterChips,
  MoneyField,
  NARROW_QUERY,
  StatCard,
  StatGrid,
  parseDisplayPreferences,
  TaxIdField,
  TextField,
} from './index';

describe('fields', () => {
  it('links label, input and error for screen readers', () => {
    render(<TextField label="Nome do produto" error="Nome do produto é obrigatório" />);
    const input = screen.getByLabelText('Nome do produto');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Nome do produto é obrigatório');
  });

  it('money field reports cents and normalizes the text', async () => {
    const onChange = vi.fn();
    render(<MoneyField label="Preço" value={null} onChange={onChange} />);
    const input = screen.getByLabelText('Preço');
    await userEvent.type(input, '1234,5');
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith(123450);
    expect(input).toHaveValue('1.234,50');
  });

  it('money field explains invalid input', async () => {
    render(<MoneyField label="Preço" value={null} onChange={() => {}} />);
    await userEvent.type(screen.getByLabelText('Preço'), 'abc');
    await userEvent.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Valor inválido');
  });

  it('tax id field masks while typing', async () => {
    let value = '';
    const { rerender } = render(<TaxIdField value={value} onChange={(v) => (value = v)} />);
    await userEvent.type(screen.getByLabelText('CPF ou CNPJ'), '1');
    rerender(<TaxIdField value="12345678909" onChange={() => {}} />);
    expect(screen.getByLabelText('CPF ou CNPJ')).toHaveValue('123.456.789-09');
    expect(value).toBe('1');
  });
});

describe('button', () => {
  it('is disabled and busy while loading', () => {
    render(<Button loading>Salvar</Button>);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
});

describe('data table', () => {
  it('rows are keyboard activatable', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="Produtos"
        rows={[{ id: '1', name: 'Arroz' }]}
        columns={[{ header: 'Nome', cell: (r) => r.name }]}
        onRowClick={onRowClick}
      />,
    );
    screen.getByText('Arroz').closest('tr')!.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Arroz' });
  });
});

describe('visual da retaguarda (F8-16)', () => {
  function fakeScreen(narrow: boolean) {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: narrow && query === NARROW_QUERY,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
  }

  it('no celular a tabela vira cartões que abrem a linha ao toque', async () => {
    fakeScreen(true);
    const onRowClick = vi.fn();
    render(
      <DataTable
        caption="Produtos"
        rows={[{ id: '1', name: 'Arroz' }]}
        columns={[{ header: 'Nome', cell: (r) => r.name }]}
        onRowClick={onRowClick}
        card={(r) => <span>{r.name} no cartão</span>}
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Produtos' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Arroz no cartão' }));
    expect(onRowClick).toHaveBeenCalledWith({ id: '1', name: 'Arroz' });
    vi.unstubAllGlobals();
  });

  it('no computador continua a tabela, mesmo com cartão definido', () => {
    fakeScreen(false);
    render(
      <DataTable
        caption="Produtos"
        rows={[{ id: '1', name: 'Arroz' }]}
        columns={[{ header: 'Nome', cell: (r) => r.name }]}
        card={(r) => <span>{r.name} no cartão</span>}
      />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('Arroz no cartão')).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('filtro em chips mostra o escolhido como pressionado', async () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        label="Situação"
        value="open"
        onChange={onChange}
        options={[
          { value: 'open', label: 'Em aberto', count: 3 },
          { value: 'paid', label: 'Pagas' },
        ]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Situação' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Em aberto \(3\)$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pagas' }));
    expect(onChange).toHaveBeenCalledWith('paid');
  });

  it('resumo em cartão e estado vazio com o próximo passo', () => {
    render(
      <>
        <StatGrid label="Resumo">
          <StatCard label="A pagar" value="R$ 10,00" valueTestId="valor" tone="orange" />
        </StatGrid>
        <EmptyState title="Nenhum produto ainda" action={<Button>Cadastrar</Button>}>
          Cadastre o primeiro.
        </EmptyState>
      </>,
    );
    expect(screen.getByRole('list', { name: 'Resumo' })).toHaveTextContent('A pagar');
    expect(screen.getByTestId('valor')).toHaveTextContent('R$ 10,00');
    expect(screen.getByRole('button', { name: 'Cadastrar' })).toBeInTheDocument();
  });
});

describe('display preferences', () => {
  it('applies theme, contrast and font size to the root element', () => {
    const root = document.createElement('html');
    applyDisplayPreferences(
      { theme: 'dark', highContrast: true, largeFont: true, beep: false },
      root,
    );
    expect(root.dataset).toMatchObject({ theme: 'dark', contrast: 'high', font: 'large' });
    applyDisplayPreferences(DEFAULT_DISPLAY, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.contrast).toBeUndefined();
  });

  it('parses stored preferences safely', () => {
    expect(parseDisplayPreferences(null)).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplayPreferences('{broken')).toEqual(DEFAULT_DISPLAY);
    expect(parseDisplayPreferences('{"largeFont":true}').largeFont).toBe(true);
  });
});
