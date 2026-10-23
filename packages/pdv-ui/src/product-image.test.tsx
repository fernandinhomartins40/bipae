import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProductImageProvider,
  resetProductImageCache,
  type ProductImageLoader,
} from './product-image';
import { ProductThumb } from './register-parts';

/** F2-14: foto do produto no caixa, com as iniciais coloridas quando a foto não vem. */

const HASH = 'a'.repeat(64);
const photo = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

beforeEach(() => {
  let n = 0;
  // O jsdom não cria endereços blob:.
  URL.createObjectURL = vi.fn(() => `blob:foto-${++n}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  resetProductImageCache();
  vi.useRealTimers();
});

function thumb(loader: ProductImageLoader | null, hash: string | null = HASH) {
  return render(
    <ProductImageProvider loader={loader}>
      <ProductThumb name="Pão de Queijo" productId="p1" imageHash={hash} />
    </ProductImageProvider>,
  );
}

describe('foto do produto no caixa (F2-14)', () => {
  it('mostra a foto quando ela carrega, buscando pelo id e pelo hash', async () => {
    const loader = vi.fn(async () => photo());
    thumb(loader);
    expect(screen.getByText('PD')).toBeTruthy();
    const img = await screen.findByTestId('product-photo');
    expect(img.getAttribute('src')).toBe('blob:foto-1');
    expect(loader).toHaveBeenCalledWith('p1', HASH);
  });

  it('a mesma foto não é baixada duas vezes', async () => {
    const loader = vi.fn(async () => photo());
    thumb(loader);
    await screen.findByTestId('product-photo');
    thumb(loader);
    await waitFor(() => expect(screen.getAllByTestId('product-photo')).toHaveLength(2));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('sem rede, sem foto ou sem quem busque, ficam as iniciais', async () => {
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    thumb(offline);
    await waitFor(() => expect(offline).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('product-photo')).toBeNull();
    expect(screen.getByText('PD')).toBeTruthy();

    const neverCalled = vi.fn(async () => photo());
    thumb(neverCalled, null);
    thumb(null);
    expect(neverCalled).not.toHaveBeenCalled();
    expect(screen.queryByTestId('product-photo')).toBeNull();
  });

  it('resposta que não é imagem também vira iniciais', async () => {
    thumb(async () => new Blob(['{"erro":true}'], { type: 'application/json' }));
    await act(async () => {});
    expect(screen.queryByTestId('product-photo')).toBeNull();
  });

  it('foto quebrada na tela volta para as iniciais', async () => {
    thumb(async () => photo());
    fireEvent.error(await screen.findByTestId('product-photo'));
    expect(screen.queryByTestId('product-photo')).toBeNull();
    expect(screen.getByText('PD')).toBeTruthy();
  });

  it('depois de uma falha, tenta de novo só passado um minuto', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let online = false;
    const loader = vi.fn(async () => {
      if (!online) throw new Error('offline');
      return photo();
    });
    const first = thumb(loader);
    await act(async () => {});
    first.unmount();
    online = true;
    const second = thumb(loader);
    await act(async () => {});
    expect(loader).toHaveBeenCalledTimes(1);
    second.unmount();
    vi.setSystemTime(Date.now() + 61_000);
    thumb(loader);
    expect(await screen.findByTestId('product-photo')).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
