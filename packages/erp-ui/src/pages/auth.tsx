import { Alert, Button, Card, Logo, TaxIdField, TextField } from '@bipae/ui';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp } from '../context';
import { useForm } from '../forms';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
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
  const form = useForm({ email: '', password: '' });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit(async (values) => {
      setMe(await api.login(values));
      navigate('/', { replace: true });
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
        <Button type="submit" size="lg" loading={form.submitting}>
          Entrar
        </Button>
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
