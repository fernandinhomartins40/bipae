import { Alert, Button, Card, Logo, TaxIdField, TextField } from '@bipae/ui';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError } from '../api-client';
import { useApp } from '../context';
import { useForm } from '../forms';

function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Logo className="text-3xl" />
          <p className="text-muted">Bipou? Bipaê!</p>
        </div>
        <Card>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mb-5 mt-1 text-muted">{subtitle}</p>
          {children}
        </Card>
      </div>
    </main>
  );
}

export function LoginPage() {
  const { api, setMe } = useApp();
  const navigate = useNavigate();
  const form = useForm({ email: '', password: '', totp: '' });
  // Second step, only for people who turned on two-step verification.
  const [needsCode, setNeedsCode] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async ({ totp, ...values }) => {
      try {
        setMe(await api.login({ ...values, ...(needsCode && { totp }) }));
        navigate('/', { replace: true });
      } catch (error) {
        if (error instanceof ApiError && error.code === 'totp_required') {
          setNeedsCode(true);
          return;
        }
        throw error;
      }
    });
  };

  return (
    <AuthLayout title="Entrar" subtitle="Que bom ver você de novo.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="E-mail"
          type="email"
          autoComplete="username"
          value={form.values.email}
          onChange={(e) => form.set('email', e.target.value)}
          error={form.errors.email}
          required
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          value={form.values.password}
          onChange={(e) => form.set('password', e.target.value)}
          error={form.errors.password}
          required
        />
        {needsCode && (
          <>
            <p className="text-muted">
              Sua conta tem verificação em duas etapas. Abra o aplicativo autenticador no celular.
            </p>
            <TextField
              label="Código de 6 dígitos"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={form.values.totp}
              onChange={(e) => form.set('totp', e.target.value.replace(/\D/g, ''))}
              error={form.errors.totp}
            />
          </>
        )}
        <Button type="submit" size="lg" loading={form.submitting}>
          {needsCode ? 'Confirmar e entrar' : 'Entrar'}
        </Button>
        <ForgotPasswordLink />
        <p className="text-center text-sm">
          Ainda não tem conta?{' '}
          <Link to="/criar-conta" className="font-semibold text-primary underline">
            Comece grátis
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function SignupPage() {
  const { api, setMe } = useApp();
  const navigate = useNavigate();
  const form = useForm({ ownerName: '', businessName: '', email: '', password: '', taxId: '' });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (values) => {
      setMe(await api.signup({ ...values, taxId: values.taxId || null }));
      navigate('/', { replace: true });
    });
  };

  return (
    <AuthLayout
      title="Crie sua conta"
      subtitle="Leva menos de um minuto. Você já pode vender logo em seguida."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField
          label="Seu nome"
          autoComplete="name"
          value={form.values.ownerName}
          onChange={(e) => form.set('ownerName', e.target.value)}
          error={form.errors.ownerName}
        />
        <TextField
          label="Nome do negócio"
          autoComplete="organization"
          value={form.values.businessName}
          onChange={(e) => form.set('businessName', e.target.value)}
          error={form.errors.businessName}
        />
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          value={form.values.email}
          onChange={(e) => form.set('email', e.target.value)}
          error={form.errors.email}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="new-password"
          hint="Pelo menos 8 caracteres."
          value={form.values.password}
          onChange={(e) => form.set('password', e.target.value)}
          error={form.errors.password}
        />
        <TaxIdField
          label="CNPJ ou CPF (opcional)"
          value={form.values.taxId}
          onChange={(v) => form.set('taxId', v)}
          error={form.errors.taxId}
        />
        <Button type="submit" size="lg" loading={form.submitting}>
          Criar conta grátis
        </Button>
        <p className="text-center text-sm">
          Já tem conta?{' '}
          <Link to="/entrar" className="font-semibold text-primary underline">
            Entrar
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}

/** O e-mail transacional está ligado no servidor? (P-04): sem ele, não há "Esqueci a senha". */
function useEmailEnabled() {
  const { api } = useApp();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ features?: { email?: boolean } }>('/health'),
    staleTime: 5 * 60_000,
  });
  return health.data?.features?.email === true;
}

export function ForgotPasswordLink() {
  const enabled = useEmailEnabled();
  if (!enabled) return null;
  return (
    <p className="text-center text-sm">
      <Link to="/esqueci-a-senha" className="font-semibold text-primary underline">
        Esqueci a senha
      </Link>
    </p>
  );
}

/** Pedir o link de senha nova por e-mail (P-04.b). */
export function ForgotPasswordPage() {
  const { api } = useApp();
  const form = useForm({ email: '' });
  const [done, setDone] = useState<string | null>(null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (values) => {
      const r = await api.post<{ message: string }>('/auth/password/forgot', values);
      setDone(r.message);
    });
  };
  return (
    <AuthLayout title="Esqueci a senha" subtitle="Mandamos um link para você criar uma senha nova.">
      {done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success" title="Confira o seu e-mail">
            {done}
          </Alert>
          <Link to="/entrar" className="text-center font-semibold text-primary underline">
            Voltar para entrar
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {form.formError && <Alert>{form.formError}</Alert>}
          <TextField
            label="E-mail da conta"
            type="email"
            autoComplete="username"
            value={form.values.email}
            onChange={(e) => form.set('email', e.target.value)}
            error={form.errors.email}
            required
          />
          <Button type="submit" size="lg" loading={form.submitting}>
            Mandar o link
          </Button>
          <Link to="/entrar" className="text-center text-sm font-semibold text-primary underline">
            Lembrei a senha
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}

/** Criar a senha nova pelo link do e-mail (P-04.b). */
export function ResetPasswordPage() {
  const { api } = useApp();
  const [params] = useSearchParams();
  const token = params.get('codigo') ?? '';
  const form = useForm({ password: '', confirm: '' });
  const [done, setDone] = useState<string | null>(null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async ({ password, confirm }) => {
      if (password !== confirm)
        throw new ApiError(400, 'validation', 'As duas senhas precisam ser iguais.');
      const r = await api.post<{ message: string }>('/auth/password/reset', { token, password });
      setDone(r.message);
    });
  };
  return (
    <AuthLayout title="Senha nova" subtitle="Escolha uma senha com pelo menos 8 caracteres.">
      {done ? (
        <div className="flex flex-col gap-4">
          <Alert tone="success" title="Pronto">
            {done}
          </Alert>
          <Link to="/entrar" className="text-center font-semibold text-primary underline">
            Entrar
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {!token && <Alert>Este link está incompleto. Peça outro em "Esqueci a senha".</Alert>}
          {form.formError && <Alert>{form.formError}</Alert>}
          <TextField
            label="Senha nova"
            type="password"
            autoComplete="new-password"
            value={form.values.password}
            onChange={(e) => form.set('password', e.target.value)}
            error={form.errors.password}
            required
          />
          <TextField
            label="Repita a senha nova"
            type="password"
            autoComplete="new-password"
            value={form.values.confirm}
            onChange={(e) => form.set('confirm', e.target.value)}
            required
          />
          <Button type="submit" size="lg" loading={form.submitting} disabled={!token}>
            Criar senha nova
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

/** Aviso na retaguarda para confirmar o e-mail da conta (P-04.c), só com o e-mail ligado. */
export function EmailVerificationBanner() {
  const { api, me } = useApp();
  const enabled = useEmailEnabled();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!enabled || !me || me.user.emailVerified !== false || me.support) return null;
  const resend = async () => {
    setError(null);
    try {
      setMessage((await api.post<{ message: string }>('/auth/email/resend', {})).message);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="mb-4">
      <Alert tone="warning" title="Confirme o seu e-mail">
        Mandamos um link para {me.user.email}. É por ele que chegam os avisos da conta e o link de
        senha nova.{' '}
        {message ? (
          message
        ) : (
          <button type="button" className="font-semibold underline" onClick={() => void resend()}>
            Reenviar o link
          </button>
        )}
        {error && ` ${error}`}
      </Alert>
    </div>
  );
}

/** Confirmar o e-mail pelo link (P-04.c). */
export function VerifyEmailPage() {
  const { api } = useApp();
  const [params] = useSearchParams();
  const token = params.get('codigo') ?? '';
  const result = useQuery({
    queryKey: ['verify-email', token],
    queryFn: () => api.post<{ message: string }>('/auth/email/verify', { token }),
    enabled: token.length >= 20,
    retry: false,
    staleTime: Infinity,
  });
  return (
    <AuthLayout title="Confirmar e-mail" subtitle="Só um instante.">
      <div className="flex flex-col gap-4">
        {token.length < 20 && <Alert>Este link está incompleto. Peça outro na retaguarda.</Alert>}
        {result.isPending && token.length >= 20 && <p className="text-muted">Confirmando…</p>}
        {result.data && (
          <Alert tone="success" title="Pronto">
            {result.data.message}
          </Alert>
        )}
        {result.error && <Alert>{(result.error as Error).message}</Alert>}
        <Link to="/" className="text-center font-semibold text-primary underline">
          Ir para o Bipaê
        </Link>
      </div>
    </AuthLayout>
  );
}

/**
 * Não receber mais ofertas (F6-08.c). Pede um clique: programas que abrem os links do e-mail
 * sozinhos (antivírus, prévia) não descadastram ninguém.
 */
export function UnsubscribePage() {
  const { api } = useApp();
  const [params] = useSearchParams();
  const token = params.get('codigo') ?? '';
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ message: string }>('/crm/campaigns/unsubscribe', { token });
      setResult({ ok: true, text: r.message });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      title="Não receber mais ofertas"
      subtitle="Você para de receber as ofertas desta loja por e-mail."
    >
      <div className="flex flex-col gap-4">
        {token.length < 20 && <Alert>Este link está incompleto. Use o link do e-mail.</Alert>}
        {result ? (
          <Alert tone={result.ok ? 'success' : 'danger'} title={result.ok ? 'Pronto' : undefined}>
            {result.text}
          </Alert>
        ) : (
          <Button
            size="lg"
            loading={busy}
            disabled={token.length < 20}
            onClick={() => void confirm()}
          >
            Não quero mais receber
          </Button>
        )}
      </div>
    </AuthLayout>
  );
}
