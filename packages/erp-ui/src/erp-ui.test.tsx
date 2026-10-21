import { createSimulatedPlatform, MemoryPreferences } from '@bipae/platform/simulators';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, BipaeApp, OFFLINE_MESSAGE } from './index';

const ME = {
  user: { id: 'u1', name: 'Rafael Souza', email: 'rafael@exemplo.com.br' },
  tenant: { id: 't1', name: 'Mercadinho do Rafael' },
  permissions: ['catalog.read'],
  tenants: [{ id: 't1', name: 'Mercadinho do Rafael' }],
};

function json(status: number, body: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authResult(n: number) {
  return {
    accessToken: `access-${n}`,
    refreshToken: `t1.s${n}.secret-${n}`,
    expiresIn: 900,
    me: ME,
  };
}

describe('ApiClient', () => {
  it('sends client and terminal headers, and the bearer token after login', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(200, authResult(1)));
    fetch.mockResolvedValueOnce(json(200, { items: [], total: 0 }));
    const preferences = new MemoryPreferences();
    const client = new ApiClient({
      baseUrl: 'http://api',
      clientKind: 'desktop',
      clientVersion: '1.2.3',
      preferences,
      fetch,
    });
    await client.login({ email: 'a@b.com', password: 'x' });
    await client.setTerminal('term-1');
    await client.get('/products');

    const [url, init] = fetch.mock.calls[1]!;
    expect(url).toBe('http://api/v1/products');
    expect(init?.headers).toMatchObject({
      'x-bipae-client': 'desktop/1.2.3',
      'x-bipae-terminal': 'term-1',
      authorization: 'Bearer access-1',
    });
    expect(await preferences.get('bipae.refreshToken')).toBe('t1.s1.secret-1');
  });

  it('refreshes once for concurrent 401s and retries', async () => {
    const preferences = new MemoryPreferences();
    await preferences.set('bipae.refreshToken', 't1.s0.secret-0');
    let refreshes = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        return json(200, authResult(refreshes));
      }
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === 'Bearer access-1' ? json(200, { ok: true }) : json(401, { message: 'x' });
    });
    const client = new ApiClient({
      baseUrl: '',
      clientKind: 'web',
      clientVersion: '0.1.0',
      preferences,
      fetch,
    });
    const results = await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
  });

  it('ends the session when refresh fails', async () => {
    const preferences = new MemoryPreferences();
    await preferences.set('bipae.refreshToken', 'old');
    const onSessionEnd = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json(401, { message: 'Sua sessão expirou.' }),
    );
    const client = new ApiClient({
      baseUrl: '',
      clientKind: 'web',
      clientVersion: '0.1.0',
      preferences,
      fetch,
      onSessionEnd,
    });
    await expect(client.get('/x')).rejects.toMatchObject({ status: 401 });
    expect(onSessionEnd).toHaveBeenCalled();
    expect(await preferences.get('bipae.refreshToken')).toBeNull();
  });

  it('turns network failures into a friendly offline error', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const client = new ApiClient({
      baseUrl: '',
      clientKind: 'web',
      clientVersion: '0.1.0',
      preferences: new MemoryPreferences(),
      fetch,
    });
    const error = await client.get('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe(OFFLINE_MESSAGE);
  });

  it('exposes field errors from the API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json(400, {
        statusCode: 400,
        code: 'validation',
        message: 'E-mail inválido',
        issues: [{ path: 'email', message: 'E-mail inválido' }],
      }),
    );
    const client = new ApiClient({
      baseUrl: '',
      clientKind: 'web',
      clientVersion: '0.1.0',
      preferences: new MemoryPreferences(),
      fetch,
    });
    const error = (await client
      .login({ email: 'x', password: 'y' })
      .catch((e: unknown) => e)) as ApiError;
    expect(error.fieldErrors()).toEqual({ email: 'E-mail inválido' });
  });
});

describe('BipaeApp', () => {
  it('shows login, signs in and greets the user with platform capabilities', async () => {
    const platform = createSimulatedPlatform('web');
    const fetchMock = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/auth/login')) return json(200, authResult(1));
      if (url.includes('/products')) return json(200, { items: [], total: 0 });
      // 401 encerraria a sessão no meio do teste; as outras rotas só não têm dados.
      return json(404, { message: 'x' });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/');

    render(<BipaeApp platform={platform} apiUrl="http://api" router="browser" />);
    await userEvent.type(await screen.findByLabelText('E-mail'), 'rafael@exemplo.com.br');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-forte-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    // Primeira tela do arquivo: no runner frio da CI, carregar o painel passa dos 5 s padrão.
    expect(
      await screen.findByRole('heading', { name: 'Olá, Rafael!' }, { timeout: 20_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Mercadinho do Rafael', { selector: 'p' })).toBeInTheDocument();
    // Fora da tela do grupo, o grupo começa fechado e abre com um toque.
    const estoque = screen.getByRole('button', { name: 'Produtos e estoque' });
    expect(estoque).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Produtos' })).not.toBeInTheDocument();
    await userEvent.click(estoque);
    expect(screen.getByRole('link', { name: 'Produtos' })).toBeVisible();
    // A busca do menu acha pela palavra do dia a dia...
    const busca = screen.getByRole('searchbox', { name: 'Procurar no menu' });
    await userEvent.type(busca, 'etiqueta');
    expect(screen.getByRole('list', { name: 'Resultados da busca' })).toHaveTextContent(
      'Etiquetas',
    );
    // ...e só mostra o que o usuário pode acessar.
    await userEvent.clear(busca);
    await userEvent.type(busca, 'convite');
    expect(screen.getByText(/Nada encontrado para “convite”/)).toBeInTheDocument();
    await userEvent.clear(busca);
    expect(screen.getByRole('button', { name: 'Minha empresa' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText('O que funciona neste navegador')).toBeInTheDocument(),
    );
    vi.unstubAllGlobals();
  });
});
