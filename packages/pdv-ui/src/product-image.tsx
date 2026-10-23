import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';

/**
 * Foto do produto no caixa (F2-14). O catálogo local só tem o hash da foto; os bytes vêm da API
 * quando há rede (e ficam no cache do navegador, porque o endereço muda junto com a foto). Sem
 * rede, sem permissão ou com a foto quebrada, a tela mostra as iniciais coloridas. Nada aqui
 * segura a venda: a foto é só enfeite.
 */
export type ProductImageLoader = (productId: string, imageHash: string) => Promise<Blob>;

const LoaderContext = createContext<ProductImageLoader | null>(null);

export function ProductImageProvider({
  loader,
  children,
}: {
  loader: ProductImageLoader | null | undefined;
  children: ReactNode;
}) {
  return <LoaderContext.Provider value={loader ?? null}>{children}</LoaderContext.Provider>;
}

/** Depois de uma falha (sem rede, por exemplo), espera este tempo antes de tentar de novo. */
export const IMAGE_RETRY_MS = 60_000;
/** Fotos guardadas na memória desta tela (as mais antigas saem primeiro). */
const MAX_CACHED = 300;

interface Entry {
  promise: Promise<string | null>;
  url: string | null;
  failedAt: number | null;
}

const cache = new Map<string, Entry>();

/** Para os testes: esquece as fotos já carregadas. */
export function resetProductImageCache() {
  for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  cache.clear();
}

function load(loader: ProductImageLoader, productId: string, hash: string): Entry {
  const key = `${productId}:${hash}`;
  const found = cache.get(key);
  if (found && !(found.failedAt !== null && Date.now() - found.failedAt > IMAGE_RETRY_MS)) {
    return found;
  }
  const entry: Entry = { url: null, failedAt: null, promise: Promise.resolve(null) };
  entry.promise = loader(productId, hash)
    .then(
      (blob) => {
        if (!blob.type.startsWith('image/') || blob.size === 0) throw new Error('não é foto');
        entry.url = URL.createObjectURL(blob);
        return entry.url;
      },
      () => {
        entry.failedAt = Date.now();
        return null;
      },
    )
    .catch(() => {
      entry.failedAt = Date.now();
      return null;
    });
  cache.set(key, entry);
  if (cache.size > MAX_CACHED) {
    const [oldest, old] = cache.entries().next().value!;
    cache.delete(oldest);
    if (old.url) URL.revokeObjectURL(old.url);
  }
  return entry;
}

/** Endereço local (blob:) da foto, ou null enquanto carrega, sem foto ou se falhou. */
export function useProductImage(
  productId: string | null | undefined,
  imageHash: string | null | undefined,
): string | null {
  const loader = useContext(LoaderContext);
  const entry = loader && productId && imageHash ? load(loader, productId, imageHash) : null;
  // A foto fica na entrada do cache; o efeito só pede um novo desenho quando ela chega.
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!entry || entry.url || entry.failedAt !== null) return;
    let alive = true;
    void entry.promise.then(() => {
      if (alive) redraw();
    });
    return () => {
      alive = false;
    };
  }, [entry]);
  return entry?.url ?? null;
}
