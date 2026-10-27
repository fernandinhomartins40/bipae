import type { Me } from '@bipae/domain';
import type { Platform } from '@bipae/platform';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from '../context';
import { IndexPage, resetMobileLanding } from './mobile-landing';

vi.mock('./home', () => ({ HomePage: () => <p>tela inicial</p> }));

function renderIndex(permissions: string[], mobile: boolean) {
  const me = {
    user: { id: 'u1', name: 'Rafael Souza', email: 'r@x.com.br' },
    tenant: { id: 't1', name: 'Loja' },
    permissions,
    tenants: [],
  } as unknown as Me;
  const platform = { kind: 'desktop', mobile, version: '1' } as unknown as Platform;
  return render(
    <AppContextProvider value={{ platform, api: {} as never, me, setMe: () => {} }}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/caixa" element={<p>aberto o caixa</p>} />
          <Route path="/garcom" element={<p>aberto o garçom</p>} />
        </Routes>
      </MemoryRouter>
    </AppContextProvider>,
  );
}

describe('abertura do app Android (F8-07)', () => {
  beforeEach(() => resetMobileLanding());

  it('no computador mostra a tela inicial de sempre', () => {
    renderIndex(['pos.sell'], false);
    expect(screen.getByText('tela inicial')).toBeTruthy();
  });

  it('no celular abre no caixa para quem só vende no caixa', () => {
    renderIndex(['pos.sell'], true);
    expect(screen.getByText('aberto o caixa')).toBeTruthy();
  });

  it('no celular abre em Vendas para quem só lança pedido', () => {
    renderIndex(['pos.order'], true);
    expect(screen.getByText('aberto o garçom')).toBeTruthy();
  });

  it('com as duas permissões deixa escolher entre Caixa e Vendas', () => {
    renderIndex(['pos.sell', 'pos.order'], true);
    expect(screen.getByRole('link', { name: /Caixa/ }).getAttribute('href')).toBe('/caixa');
    expect(screen.getByRole('link', { name: /Vendas/ }).getAttribute('href')).toBe('/garcom');
  });

  it('sem nenhuma das duas cai na tela inicial, e a segunda visita não volta ao caixa', () => {
    renderIndex(['finance.read'], true);
    expect(screen.getByText('tela inicial')).toBeTruthy();
    renderIndex(['pos.sell'], true);
    expect(screen.getAllByText('aberto o caixa').length).toBe(1);
    renderIndex(['pos.sell'], true);
    expect(screen.getAllByText('tela inicial').length).toBe(2);
  });
});
