import { SelectField, TextField } from '@bipae/ui';
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

export interface StPautaRef {
  uf: string;
  annex: string;
  item: string;
}

interface StPautaItemView {
  annex: string;
  tableName: string;
  item: string;
  cest: string;
  description: string;
  priceCents: number;
}

const brl = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Decreto de carga líquida da CNAE principal da empresa e as classes da tabela do comprador. */
export interface StNetLoadClassesView {
  status: string;
  regime: { act: string; segmentName: string; url: string; cestSegments: string[] | null } | null;
  classes: { goodsClass: string; label: string }[];
  message: string;
  /** Escolhas que o texto do decreto deixa para a empresa (F3-26.d.CE.e). */
  choices?: {
    act: string;
    transferMargin: { caputMva: string; transferMva: string; interstateOnly: boolean } | null;
    industryLoad: {
      article: string;
      load: string;
      standardArticle: string;
      standardLoad: string;
    } | null;
    distributionCenter: { article: string } | null;
  } | null;
  /** Carga fixa por produto (carnes do Maranhão, F3-26.d.MA.d): vale sem CNAE. */
  product?: {
    mva: string;
    accreditation: { act: string; validFrom: string };
    version: {
      interstateEntry: string;
      internalAccredited: string;
      interstateExitAccredited: string;
    } | null;
  };
}

/** Valor que diz "o produto está fora do regime" (exclusões do decreto). */
export const NET_LOAD_OUTSIDE = 'outside';

/**
 * O decreto de carga líquida da CNAE da empresa (F3-26.d.CE.c) ou o regime por produto da UF
 * (carnes do Maranhão, F3-26.d.MA.d, que vale sem CNAE); nada quando falta a UF.
 */
export function useStNetLoadClasses(
  uf: string | null | undefined,
  cnae: string | null | undefined,
  cest?: string,
) {
  const { api } = useApp();
  const digits = (cnae ?? '').replace(/\D/g, '');
  const code = /^\d{7}$/.test(cest ?? '') ? cest : '';
  return useQuery({
    queryKey: ['st-net-load-classes', uf, digits, code],
    queryFn: () =>
      api.get<StNetLoadClassesView>(
        `/fiscal/st-net-load-classes?uf=${uf}${digits.length === 7 ? `&cnae=${digits}` : ''}${code ? `&cest=${code}` : ''}`,
      ),
    enabled: Boolean(uf),
  });
}

/**
 * Classe da mercadoria na ST com carga líquida (F3-26.d.CE.c, dúvida D-042): só aparece quando a
 * CNAE principal da empresa está num decreto. A classe decide o percentual na entrada da compra;
 * "fora do regime" é para os produtos que o decreto exclui. O Bipaê não deduz a classe.
 */
export function StNetLoadClassPicker({
  uf,
  cnae,
  cest,
  value,
  onChange,
}: {
  uf: string | null;
  cnae: string | null;
  cest: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const found = useStNetLoadClasses(uf, cnae, cest).data;
  if (!found?.regime) return null;
  const known = found.classes.some((c) => c.goodsClass === value) || value === NET_LOAD_OUTSIDE;
  return (
    <SelectField
      label={
        found.product
          ? 'Carne ou gado bovino ou bubalino (ST por carga fixa)'
          : 'Classe da mercadoria (ST com carga líquida)'
      }
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      options={[
        { value: '', label: 'Não informada (a compra avisa)' },
        ...found.classes.map((c) => ({ value: c.goodsClass, label: c.label })),
        ...(value && !known ? [{ value, label: `${value} (fora da tabela atual)` }] : []),
        {
          value: NET_LOAD_OUTSIDE,
          label: found.product
            ? 'Fora do regime (não é do anexo, como a carne ovina)'
            : 'Fora do regime (exclusões do decreto)',
        },
      ]}
      hint={
        found.product
          ? `${found.message} O anexo não traz NCM nem CEST: quem diz se o produto está nele é a empresa, com o contador.`
          : found.classes.length > 0
            ? `${found.regime.act}: a carga da entrada depende da carga interna da mercadoria. Confira com o contador.`
            : found.message
      }
    />
  );
}

/**
 * Item da pauta da ST (F3-26.f): quando a UF da empresa publica pauta para o CEST do produto, a
 * base da ST na NF-e é o valor da pauta da marca e embalagem. Só aparece quando há pauta.
 */
export function StPautaPicker({
  uf,
  cest,
  value,
  onChange,
}: {
  uf: string | null;
  cest: string;
  value: StPautaRef | null;
  onChange: (value: StPautaRef | null) => void;
}) {
  const { api } = useApp();
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const enabled = Boolean(uf) && /^\d{7}$/.test(cest);
  const found = useQuery({
    queryKey: ['st-pauta', uf, cest, term],
    queryFn: () =>
      api.get<{ pauta: { act: string; validTo: string } | null; items: StPautaItemView[] }>(
        `/fiscal/st-pauta?uf=${uf}&cest=${cest}&q=${encodeURIComponent(term)}`,
      ),
    enabled,
  });
  const pauta = found.data?.pauta;
  if (!enabled || !pauta || (found.data!.items.length === 0 && !term && !value)) return null;
  const until = pauta.validTo.split('-').reverse().join('/');
  return (
    <section className="rounded-ui border border-border p-3" aria-labelledby="st-pauta">
      <h3 id="st-pauta" className="mb-1 font-bold">
        Pauta da ST ({uf})
      </h3>
      <p className="mb-2 text-sm text-muted">
        {pauta.act}, até {until}. Na NF-e, a base da ST passa a ser o valor da pauta da marca e
        embalagem. Só vale para quem retém o imposto (indústria, importador ou distribuidor).
      </p>
      {value ? (
        <p className="mb-2 text-sm">
          Escolhido: item {value.item} do Anexo {value.annex}.{' '}
          <button
            type="button"
            className="font-semibold text-primary underline"
            onClick={() => onChange(null)}
          >
            Tirar
          </button>
        </p>
      ) : null}
      <TextField
        label="Procurar na pauta"
        hint="Marca, embalagem ou tamanho (ex.: lata 350)."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-auto" aria-label="Itens da pauta">
        {found.data!.items.map((i) => (
          <li key={`${i.annex}-${i.item}`}>
            <button
              type="button"
              className="w-full rounded-ui px-2 py-1 text-left text-sm hover:bg-primary/10 aria-pressed:bg-primary/15"
              aria-pressed={value?.annex === i.annex && value.item === i.item}
              onClick={() => onChange({ uf: uf!, annex: i.annex, item: i.item })}
            >
              {i.item} · {i.tableName} · {i.description} · {brl(i.priceCents)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
