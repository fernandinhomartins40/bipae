import { TextField } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useApp } from '../context';

/**
 * Consulta às tabelas fiscais oficiais (F3-06.b): as listas do perfil fiscal, a busca de NCM pelo
 * nome do produto e a sugestão de CEST. Os dados vêm de `/v1/fiscal/*`; as tabelas são grandes e
 * ficam no servidor.
 */
export interface FiscalCode {
  code: string;
  description: string;
}

export interface FiscalOptions {
  origins: FiscalCode[];
  cstIcms: FiscalCode[];
  csosn: FiscalCode[];
  cstPisCofins: FiscalCode[];
  cfopInterna: FiscalCode[];
  cfopInterestadual: FiscalCode[];
  classTrib: (FiscalCode & { cst: string; pRedIBS: string; pRedCBS: string; nfce: boolean })[];
  regimes: {
    id: string;
    label: string;
    hint: string;
    crt: number;
    icmsCode: 'csosn' | 'cst';
    ibsCbsRegularOption: boolean;
  }[];
  ufRates: {
    uf: string;
    status: 'confirmado' | 'pendente' | 'divergente';
    rate: string | null;
    law: string;
  }[];
}

/** "20.5" → "20,5%". */
export const formatRate = (rate: string) => `${rate.replace('.', ',')}%`;

interface NcmResult {
  code: string;
  description: string;
  path: string[];
}

interface CestResult {
  cest: string;
  description: string;
  segment: string;
  ncm: string;
}

const HOUR = 60 * 60_000;

/** As listas de códigos oficiais; mudam raramente, então ficam guardadas por uma hora. */
export function useFiscalOptions() {
  const { api } = useApp();
  return useQuery({
    queryKey: ['fiscal-options'],
    queryFn: () => api.get<FiscalOptions>('/fiscal/options'),
    staleTime: HOUR,
  });
}

/**
 * Texto de ajuda de um campo de código: a descrição oficial do que foi digitado, ou o aviso de que
 * o código não está na tabela. Enquanto a lista não carrega, fica a dica padrão do campo.
 */
export function codeHint(
  list: FiscalCode[] | undefined,
  code: string,
  length: number,
  fallback: string,
): string {
  if (!list || code.length !== length) return fallback;
  const found = list.find((item) => item.code === code);
  return found
    ? found.description
    : 'Este código não está na tabela oficial. Confira antes de salvar.';
}

/** Sugestões nativas do navegador para um campo de código (digitar continua funcionando). */
export function CodeSuggestions({ id, list }: { id: string; list: FiscalCode[] | undefined }) {
  return (
    <datalist id={id}>
      {(list ?? []).map((item) => (
        <option key={item.code} value={item.code}>
          {item.description}
        </option>
      ))}
    </datalist>
  );
}

const ncmMask = (code: string) => `${code.slice(0, 4)}.${code.slice(4, 6)}.${code.slice(6)}`;
const cestMask = (code: string) => `${code.slice(0, 2)}.${code.slice(2, 5)}.${code.slice(5)}`;

/**
 * Ajuda do NCM e do CEST no cadastro de produto: mostra o que é o NCM digitado, deixa buscar o
 * NCM pelo nome da mercadoria e sugere os CEST previstos para ele.
 */
export function NcmCestHelp({
  ncm,
  cest,
  onPickNcm,
  onPickCest,
}: {
  ncm: string;
  cest: string;
  onPickNcm: (code: string) => void;
  onPickCest: (code: string) => void;
}) {
  const { api } = useApp();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const complete = /^\d{8}$/.test(ncm);

  const current = useQuery({
    queryKey: ['fiscal-ncm', ncm],
    queryFn: () => api.get<NcmResult>(`/fiscal/ncm/${ncm}`),
    enabled: complete,
    retry: false,
    staleTime: HOUR,
  });
  const results = useQuery({
    queryKey: ['fiscal-ncm-search', term],
    queryFn: () =>
      api.get<{ items: NcmResult[] }>(`/fiscal/ncm?limit=8&q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
    staleTime: HOUR,
  });
  const cests = useQuery({
    queryKey: ['fiscal-cest', ncm],
    queryFn: () => api.get<{ items: CestResult[] }>(`/fiscal/cest?ncm=${ncm}`),
    enabled: complete && current.isSuccess,
    staleTime: HOUR,
  });

  return (
    <div className="flex flex-col gap-3 rounded-ui border border-border bg-surface-2 p-3 text-sm">
      {complete && current.data && (
        <p>
          <span className="font-semibold">NCM {ncmMask(current.data.code)}:</span>{' '}
          {[...current.data.path, current.data.description].join(' › ')}
        </p>
      )}
      {complete && current.isError && (
        <p className="font-semibold text-danger" role="alert">
          O NCM {ncmMask(ncm)} não está na tabela vigente. Busque pelo nome do produto abaixo.
        </p>
      )}

      <TextField
        label="Não sabe o NCM? Busque pelo nome da mercadoria"
        placeholder="Ex.: arroz polido, cerveja, sabonete"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {term.length >= 2 && results.data && results.data.items.length === 0 && (
        <p>
          Nada encontrado. Tente outra palavra ou peça o NCM ao fornecedor (ele vem na nota de
          compra).
        </p>
      )}
      {term.length >= 2 && results.data && results.data.items.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="NCM encontrados">
          {results.data.items.map((item) => (
            <li key={item.code}>
              <button
                type="button"
                className="w-full rounded-ui border border-border bg-surface px-3 py-2 text-left hover:border-primary"
                onClick={() => {
                  onPickNcm(item.code);
                  setSearch('');
                }}
              >
                <span className="font-semibold">{ncmMask(item.code)}</span> — {item.description}
                {item.path.length > 0 && (
                  <span className="block text-muted">
                    {item.path.slice(1).join(' › ') || item.path[0]}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {cests.data && cests.data.items.length > 0 && (
        <div>
          <p className="mb-1 font-semibold">CEST previstos para este NCM</p>
          <p className="mb-2 text-muted">
            Só preencha se o produto estiver em substituição tributária no seu estado. Na dúvida,
            pergunte ao contador.
          </p>
          <ul className="flex flex-col gap-1" aria-label="CEST sugeridos">
            {cests.data.items.slice(0, 8).map((item) => (
              <li key={item.cest}>
                <button
                  type="button"
                  aria-pressed={cest === item.cest}
                  className="w-full rounded-ui border border-border bg-surface px-3 py-2 text-left hover:border-primary aria-pressed:border-primary"
                  onClick={() => onPickCest(item.cest)}
                >
                  <span className="font-semibold">{cestMask(item.cest)}</span> — {item.description}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cests.data && cests.data.items.length === 0 && (
        <p className="text-muted">
          Não há CEST previsto para este NCM: pode deixar o campo CEST em branco.
        </p>
      )}
    </div>
  );
}
