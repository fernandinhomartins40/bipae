import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import { useForm } from './forms';

describe('erros do servidor no formulário (PIE R2-07)', () => {
  it('erro de um campo que a tela mostra fica no campo, sem aviso geral', async () => {
    const { result } = renderHook(() => useForm({ name: '' }));
    await act(() =>
      result.current.submit(async () => {
        throw new ApiError(400, 'invalid', 'Dados inválidos', [
          { path: 'name', message: 'Informe o nome' },
        ]);
      }),
    );
    expect(result.current.errors).toEqual({ name: 'Informe o nome' });
    expect(result.current.formError).toBeNull();
  });

  it('erro num item de um campo da tela (barcodes.0) fica só no campo', async () => {
    const { result } = renderHook(() => useForm({ barcodes: '7891000315508' }));
    await act(() =>
      result.current.submit(async () => {
        throw new ApiError(400, 'invalid', 'Dados inválidos', [
          { path: 'barcodes.0', message: 'Dígito verificador do código de barras inválido' },
        ]);
      }),
    );
    expect(result.current.formError).toBeNull();
  });

  it('erro de um campo que a tela não tem aparece no aviso geral', async () => {
    const { result } = renderHook(() => useForm({ name: 'Kit café' }));
    await act(() =>
      result.current.submit(async () => {
        throw new ApiError(400, 'invalid', 'Dados inválidos', [
          { path: 'components.0.quantity', message: 'A quantidade precisa ser maior que zero' },
        ]);
      }),
    );
    expect(result.current.formError).toBe('A quantidade precisa ser maior que zero');
  });
});
