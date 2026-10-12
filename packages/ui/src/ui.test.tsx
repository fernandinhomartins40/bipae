import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  applyDisplayPreferences,
  Button,
  DataTable,
  DEFAULT_DISPLAY,
  MoneyField,
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

describe('display preferences', () => {
  it('applies theme, contrast and font size to the root element', () => {
    const root = document.createElement('html');
    applyDisplayPreferences({ theme: 'dark', highContrast: true, largeFont: true, beep: false }, root);
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
