import type { InviteInfo, Me } from '@bipae/domain';
import { Alert, Button, Card, Checkbox, Drawer, Logo, SelectField, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../api-client';
import { useApp } from '../context';

// ---------------------------------------------------------------- página pública de aceite

/** /convite/:token — quem recebeu o link entra na empresa (com a conta que tem ou uma nova). */
export function InvitePage() {
  const { token = '' } = useParams();
  const { api, setMe } = useApp();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InviteInfo>(`/auth/invites/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [v, setV] = useState({ name: '', email: '', password: '', totp: '' });
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const email = info.data?.email ?? v.email;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const result = await api.post<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        me: Me;
      }>(`/auth/invites/${encodeURIComponent(token)}/accept`, {
        email,
        password: v.password,
        ...(mode === 'new' && { name: v.name }),
        ...(needsCode && { totp: v.totp }),
      });
      setMe(await api.adopt(result));
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') {
        setNeedsCode(true);
        return;
      }
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const STATUS = {
    expired: 'Este convite venceu. Peça um novo para quem enviou.',
    used: 'Este convite já foi usado.',
    revoked: 'Este convite foi cancelado.',
  } as const;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="text-3xl" />
        </div>
        <Card>
          {info.isPending && <p className="text-muted">Abrindo o convite…</p>}
          {info.error && <Alert>{(info.error as Error).message}</Alert>}
          {info.data && info.data.status !== 'valid' && (
            <>
              <h1 className="text-2xl font-bold">Convite indisponível</h1>
              <div className="mt-3">
                <Alert>{STATUS[info.data.status]}</Alert>
              </div>
            </>
          )}
          {info.data?.status === 'valid' && (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <h1 className="text-2xl font-bold">Você foi convidado!</h1>
                <p className="mt-1 text-muted">
                  Para entrar em <strong>{info.data.businessName}</strong> como{' '}
                  <strong>{info.data.roleName}</strong>.
                </p>
              </div>
              <div
                className="flex rounded-ui border border-border p-1"
                role="radiogroup"
                aria-label="Como entrar"
              >
                {(
                  [
                    ['new', 'Criar minha conta'],
                    ['existing', 'Já tenho conta no Bipaê'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={mode === key}
                    onClick={() => setMode(key)}
                    className={`min-h-10 flex-1 rounded-ui text-sm font-semibold ${
                      mode === key ? 'bg-primary text-primary-contrast' : ''
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {error && <Alert>{error}</Alert>}
              {mode === 'new' && (
                <TextField
                  label="Seu nome"
                  value={v.name}
                  onChange={(e) => setV({ ...v, name: e.target.value })}
                  autoFocus
                />
              )}
              <TextField
                label="E-mail"
                type="email"
                value={email}
                readOnly={Boolean(info.data.email)}
                hint={info.data.email ? 'Este convite é para este e-mail.' : undefined}
                onChange={(e) => setV({ ...v, email: e.target.value })}
              />
              <TextField
                label={mode === 'new' ? 'Crie uma senha' : 'Sua senha'}
                type="password"
                autoComplete={mode === 'new' ? 'new-password' : 'current-password'}
                value={v.password}
                onChange={(e) => setV({ ...v, password: e.target.value })}
              />
              {needsCode && (
                <TextField
                  label="Código de 6 dígitos"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={v.totp}
                  onChange={(e) =>
                    setV({ ...v, totp: e.target.value.replace(/\D/g, '').slice(0, 6) })
                  }
                />
              )}
              <Button type="submit" size="lg" loading={sending}>
                Aceitar convite e entrar
              </Button>
            </form>
          )}
        </Card>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- equipe: convidar e pendentes

interface Role {
  id: string;
  name: string;
  systemKey: string | null;
}
interface PendingInvite {
  id: string;
  roleName: string;
  email: string | null;
  expiresAt: string;
}

/** Endereço público do link: no navegador é este app; no desktop, o Bipaê Online. */
function inviteUrl(path: string, desktop: boolean) {
  const base = desktop ? 'https://www.bipae.com.br/app/' : document.baseURI;
  return new URL(path.replace(/^\//, ''), base).toString();
}

export function InviteDrawer({
  roles,
  stores,
  onClose,
}: {
  roles: Role[];
  stores: { id: string; name: string }[];
  onClose: () => void;
}) {
  const { api, platform } = useApp();
  const queryClient = useQueryClient();
  const assignable = roles.filter((r) => r.systemKey !== 'owner');
  const [roleId, setRoleId] = useState(
    assignable.find((r) => r.systemKey === 'cashier')?.id ?? assignable[0]?.id ?? '',
  );
  const [email, setEmail] = useState('');
  const [all, setAll] = useState(true);
  const [chosen, setChosen] = useState<string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!all && chosen.length === 0) {
      setError('Escolha pelo menos uma loja ou marque "Todas as lojas".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ path: string }>('/invites', {
        roleId,
        email: email.trim() || null,
        storeIds: all ? null : chosen,
      });
      setLink(inviteUrl(result.path, platform.kind === 'desktop'));
      await queryClient.invalidateQueries({ queryKey: ['invites'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Convidar por link">
      {link ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success" title="Convite criado">
            Envie este link para a pessoa (WhatsApp, e-mail...). Ele vale por 7 dias e só pode ser
            usado uma vez.
          </Alert>
          <TextField
            label="Link do convite"
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <Button
            icon={<Copy className="size-4" aria-hidden />}
            onClick={() =>
              void navigator.clipboard.writeText(link).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? 'Link copiado!' : 'Copiar link'}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Concluir
          </Button>
        </div>
      ) : (
        <form onSubmit={create} className="flex flex-col gap-4">
          <p className="text-muted">
            Para quem já tem conta no Bipaê (ex.: o contador) ou prefere criar a própria senha.
          </p>
          {error && <Alert>{error}</Alert>}
          <SelectField
            label="Papel"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            options={assignable.map((r) => ({ value: r.id, label: r.name }))}
          />
          <TextField
            label="E-mail da pessoa (opcional)"
            type="email"
            hint="Se informar, só esse e-mail consegue aceitar."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Checkbox label="Todas as lojas" checked={all} onChange={setAll} />
          {!all &&
            stores.map((s) => (
              <Checkbox
                key={s.id}
                label={s.name}
                checked={chosen.includes(s.id)}
                onChange={(on) =>
                  setChosen((list) => (on ? [...list, s.id] : list.filter((id) => id !== s.id)))
                }
              />
            ))}
          <Button type="submit" loading={busy} icon={<Link2 className="size-4" aria-hidden />}>
            Gerar link do convite
          </Button>
        </form>
      )}
    </Drawer>
  );
}

export function PendingInvites() {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ['invites'],
    queryFn: () => api.get<PendingInvite[]>('/invites'),
  });
  if (!list.data || list.data.length === 0) return null;
  return (
    <section className="mt-6" aria-labelledby="convites-pendentes">
      <h2 id="convites-pendentes" className="mb-2 text-lg font-bold">
        Convites pendentes
      </h2>
      <ul className="flex flex-col gap-2">
        {list.data.map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-ui border border-border p-3"
          >
            <span>
              <strong>{i.roleName}</strong>
              {i.email && <span className="text-muted"> · {i.email}</span>}
              <span className="text-sm text-muted">
                {' '}
                · vale até {new Date(i.expiresAt).toLocaleDateString('pt-BR')}
              </span>
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                await api.post(`/invites/${i.id}/revoke`);
                await queryClient.invalidateQueries({ queryKey: ['invites'] });
              }}
            >
              Cancelar convite
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
