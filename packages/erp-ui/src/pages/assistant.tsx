import {
  AI_CONFIDENCE_LABELS,
  AI_TOOL_LABELS,
  type AiActionView,
  type AiAnswer,
  type AiStatus,
  type AiSuggestionView,
} from '@bipae/domain';
import { Alert, Badge, Button, Checkbox, Field, PageHeader } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApp, useCan } from '../context';

const useAiStatus = () => {
  const { api } = useApp();
  return useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatus>('/ai/status') });
};

const EXAMPLES = [
  'Quanto vendi nesta semana?',
  'Quais foram os 5 produtos que mais venderam neste mês?',
  'Quanto lucrei no mês passado?',
  'Tenho contas vencidas?',
];

/**
 * Assistente de IA (F6-07, ADR-0011): perguntas sobre o negócio respondidas com os relatórios
 * da conta. Opcional; desligado, nada muda no resto do Bipaê.
 */
export function AssistantPage() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const canManage = useCan('admin.integrations');
  const canAsk = useCan('finance.read');
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<
    { role: 'user' | 'assistant'; text: string; tools?: string[]; proposals?: AiActionView[] }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (enabled: boolean) => {
    setError(null);
    try {
      await api.put('/ai/settings', { enabled });
      await queryClient.invalidateQueries({ queryKey: ['ai'] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ask = async (e?: FormEvent, text = question) => {
    e?.preventDefault();
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    try {
      const history = chat.slice(-6).map(({ role, text: t }) => ({ role, text: t }));
      const r = await api.post<AiAnswer>('/ai/ask', { question: q, history });
      setChat([
        ...chat,
        { role: 'user', text: q },
        { role: 'assistant', text: r.answer, tools: r.tools, proposals: r.proposals ?? [] },
      ]);
      setQuestion('');
      await queryClient.invalidateQueries({ queryKey: ['ai', 'status'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = status.data;
  return (
    <>
      <PageHeader
        title="Assistente"
        description="Pergunte sobre as vendas, o lucro e as contas da loja. O assistente responde com os relatórios do Bipaê e nunca muda nada sozinho."
      />
      {status.error && <Alert>{(status.error as Error).message}</Alert>}
      {s && !s.configured && (
        <Alert tone="warning" title="Falta configurar">
          O assistente de IA ainda não está ligado no Bipaê. Assim que estiver, você liga aqui para
          a sua conta.
        </Alert>
      )}
      {s?.configured && (
        <section className="mb-6 rounded-ui border border-border p-4" aria-labelledby="ia-conta">
          <h2 id="ia-conta" className="mb-1 text-lg font-bold">
            Assistente nesta conta
          </h2>
          <p className="mb-3 text-sm text-muted">
            Vão ao provedor de IA só números dos relatórios e o cadastro dos produtos. Nome, CPF e
            contato de clientes não saem do Bipaê. Usos hoje: {s.usedToday} de {s.dailyLimit}.
          </p>
          {canManage ? (
            <Checkbox
              label="Assistente ligado"
              checked={s.enabled}
              onChange={(v) => void toggle(v)}
            />
          ) : (
            <p className="text-sm">
              {s.enabled ? 'Ligado.' : 'Desligado. Peça para quem cuida da conta ligar.'}
            </p>
          )}
        </section>
      )}
      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {s?.configured && s.enabled && canAsk && (
        <section aria-labelledby="ia-perguntas">
          <h2 id="ia-perguntas" className="mb-2 text-lg font-bold">
            Perguntas
          </h2>
          {chat.length === 0 && (
            <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Exemplos">
              {EXAMPLES.map((example) => (
                <Button key={example} variant="ghost" onClick={() => void ask(undefined, example)}>
                  {example}
                </Button>
              ))}
            </div>
          )}
          <ol className="mb-3 flex flex-col gap-3" aria-label="Conversa" aria-live="polite">
            {chat.map((m, i) => (
              <li
                key={i}
                className={
                  m.role === 'user'
                    ? 'self-end rounded-ui bg-primary/10 px-3 py-2'
                    : 'rounded-ui border border-border px-3 py-2'
                }
              >
                <span className="sr-only">{m.role === 'user' ? 'Você: ' : 'Assistente: '}</span>
                <p className="whitespace-pre-line">{m.text}</p>
                {m.proposals?.map((p) => (
                  <ProposalCard key={p.id} proposal={p} />
                ))}
                {m.tools && m.tools.length > 0 && (
                  <p className="mt-1 text-sm text-muted">
                    Consultado:{' '}
                    {[...new Set(m.tools)].map((t) => AI_TOOL_LABELS[t] ?? t).join(', ')}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <form onSubmit={(e) => void ask(e)} className="flex flex-col gap-2">
            <Field label="Sua pergunta">
              {(a11y) => (
                <textarea
                  {...a11y}
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-ui border border-border bg-surface p-3 text-base text-text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              )}
            </Field>
            <div>
              <Button type="submit" loading={busy}>
                Perguntar
              </Button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}

/**
 * Sugestão fiscal da IA no cadastro do produto (F6-07): só aparece com o assistente ligado. A
 * sugestão não grava nada até alguém aprovar; a aprovação fica na auditoria.
 */
export function AiFiscalSuggestionPanel({
  productId,
  onApplied,
}: {
  productId: string;
  onApplied: (values: {
    ncm: string | null;
    cest: string | null;
    fiscalProfileId: string | null;
  }) => void;
}) {
  const { api } = useApp();
  const status = useAiStatus();
  const canWrite = useCan('catalog.write');
  const [current, setCurrent] = useState<AiSuggestionView | null>(null);
  const [busy, setBusy] = useState<'suggest' | 'approve' | 'reject' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!status.data?.configured || !status.data.enabled || !canWrite) return null;

  const run = async (kind: 'suggest' | 'approve' | 'reject') => {
    setBusy(kind);
    setMessage(null);
    try {
      if (kind === 'suggest') {
        setCurrent(
          await api.post<AiSuggestionView>(`/ai/products/${productId}/fiscal-suggestions`),
        );
      } else if (current) {
        const done = await api.post<AiSuggestionView>(
          `/ai/fiscal-suggestions/${current.id}/${kind}`,
        );
        setCurrent(null);
        if (kind === 'approve') {
          const s = done.suggestion;
          onApplied({ ncm: s.ncm, cest: s.cest, fiscalProfileId: s.fiscalProfileId });
          setMessage({ ok: true, text: 'Sugestão aprovada e gravada no produto.' });
        } else {
          setMessage({ ok: true, text: 'Sugestão recusada. Nada mudou no produto.' });
        }
      }
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const s = current?.suggestion;
  return (
    <section className="rounded-ui border border-border p-3" aria-labelledby="ia-fiscal">
      <h3 id="ia-fiscal" className="mb-1 font-bold">
        Sugestão da IA
      </h3>
      <p className="mb-2 text-sm text-muted">
        A IA sugere NCM, CEST e cClassTrib conferidos nas tabelas oficiais. Confira antes de
        aprovar: nada grava sem você.
      </p>
      {message && (
        <div className="mb-2">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      {s ? (
        <div className="flex flex-col gap-2">
          <Badge
            tone={
              s.confidence === 'alta' ? 'success' : s.confidence === 'media' ? 'neutral' : 'warning'
            }
          >
            {AI_CONFIDENCE_LABELS[s.confidence]}
          </Badge>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-semibold">NCM</dt>
            <dd>{s.ncm ? `${s.ncm} · ${s.ncmDescription ?? ''}` : '—'}</dd>
            <dt className="font-semibold">CEST</dt>
            <dd>{s.cest ?? '—'}</dd>
            <dt className="font-semibold">cClassTrib</dt>
            <dd>{s.cClassTrib ?? '—'}</dd>
          </dl>
          <p className="text-sm">{s.justification}</p>
          {s.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === 'approve'} onClick={() => void run('approve')}>
              Aprovar e gravar
            </Button>
            <Button variant="ghost" loading={busy === 'reject'} onClick={() => void run('reject')}>
              Recusar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          loading={busy === 'suggest'}
          onClick={() => void run('suggest')}
        >
          Sugerir com IA
        </Button>
      )}
    </section>
  );
}

/**
 * Proposta do assistente (ADR-0011): ele só propõe; o preço só muda quando uma pessoa com
 * permissão confirma aqui. Recusar não muda nada.
 */
function ProposalCard({ proposal }: { proposal: AiActionView }) {
  const { api } = useApp();
  const canDecide = useCan('catalog.price.write');
  const [current, setCurrent] = useState(proposal);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (kind: 'approve' | 'reject') => {
    setBusy(kind);
    setError(null);
    try {
      setCurrent(await api.post<AiActionView>(`/ai/actions/${current.id}/${kind}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-2 rounded-ui border border-border bg-surface p-3">
      <p className="font-semibold">Proposta: {current.summary}</p>
      <p className="text-sm text-muted">{current.payload.reason}</p>
      {error && <Alert>{error}</Alert>}
      {current.status === 'pending' ? (
        canDecide ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button loading={busy === 'approve'} onClick={() => void decide('approve')}>
              Confirmar e mudar o preço
            </Button>
            <Button
              variant="ghost"
              loading={busy === 'reject'}
              onClick={() => void decide('reject')}
            >
              Recusar
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-sm">Quem tem permissão de preço precisa confirmar.</p>
        )
      ) : (
        <p className="mt-2 text-sm">
          {current.status === 'approved'
            ? 'Confirmada: o preço foi alterado.'
            : 'Recusada: nada mudou.'}
        </p>
      )}
    </div>
  );
}
