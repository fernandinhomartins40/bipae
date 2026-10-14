import { parseBRL } from '@bipae/domain';
import type { Platform } from '@bipae/platform';
import { Alert, Button, Card, Logo, TextField } from '@bipae/ui';
import { useEffect, useState, type FormEvent } from 'react';
import type { PosBackend, PosTerminal, PosUser } from './backend';
import { brl } from './dialogs';
import { Register } from './register';
import { useRegister, type RegisterHandle } from './use-register';

/**
 * The register for this device. Same component in Bipaê Online and Bipaê Desktop
 * (ADR-0012); only the platform (local database driver, peripherals) differs.
 */
export function PosApp({
  platform,
  backend,
  user,
  onExit,
}: {
  platform: Platform;
  backend: PosBackend;
  user: PosUser;
  onExit: () => void;
}) {
  const register = useRegister(platform, backend, user);
  const { state } = register;

  if (state.phase === 'loading') {
    return (
      <Centered>
        <Logo className="animate-pulse text-3xl" />
        <p className="text-muted" role="status">
          Preparando o caixa…
        </p>
      </Centered>
    );
  }
  if (state.phase === 'error') {
    return (
      <Centered>
        <Alert title="Não foi possível abrir o caixa">{state.message}</Alert>
        <div className="flex gap-2">
          <Button onClick={register.retry}>Tentar de novo</Button>
          <Button variant="secondary" onClick={onExit}>
            Voltar
          </Button>
        </div>
      </Centered>
    );
  }
  if (state.phase === 'needs-terminal') {
    return <TerminalPicker platform={platform} backend={backend} user={user} onLinked={register.linkTerminal} onExit={onExit} />;
  }
  if (!register.session) {
    return <OpenSession handle={state.handle} onOpened={register.refreshSession} onExit={onExit} />;
  }
  return (
    <Register
      handle={state.handle}
      session={register.session}
      user={user}
      platform={platform}
      backend={backend}
      syncStatus={register.syncStatus}
      onSyncNow={() => register.syncNow()}
      onSessionClosed={() => void register.refreshSession()}
      onExit={onExit}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">{children}</div>
    </main>
  );
}

function TerminalPicker({
  platform,
  backend,
  user,
  onLinked,
  onExit,
}: {
  platform: Platform;
  backend: PosBackend;
  user: PosUser;
  onLinked: (terminalId: string) => void;
  onExit: () => void;
}) {
  const [terminals, setTerminals] = useState<PosTerminal[] | null>(null);
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canCreate = user.permissions.includes('admin.terminals');

  useEffect(() => {
    backend.listTerminals().then(setTerminals).catch((e: Error) => setError(e.message));
    if (canCreate) backend.listStores().then(setStores).catch(() => undefined);
  }, [backend, canCreate]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const terminal = await backend.createTerminal({ storeId: stores[0]!.id, name: name || 'Caixa', platform: platform.kind });
      onLinked(terminal.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <h1 className="text-2xl font-bold">Qual caixa é este aparelho?</h1>
        <p className="mb-4 mt-1 text-muted">
          Cada caixa tem sua própria numeração de vendas e de NFC-e. Escolha um caixa livre ou crie um novo.
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-col gap-2">
          {terminals?.map((t) => (
            <Button key={t.id} variant="secondary" size="lg" className="justify-between" onClick={() => onLinked(t.id)}>
              <span>{t.name}</span>
              <span className="text-sm text-muted">série {t.nfceSeries}</span>
            </Button>
          ))}
          {terminals?.length === 0 && !canCreate && (
            <p className="text-muted">Nenhum caixa cadastrado. Peça ao gerente para criar um em Caixas.</p>
          )}
        </div>
        {canCreate && stores.length > 0 && (
          <form onSubmit={create} className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
            <TextField label="Novo caixa" placeholder="Ex.: Caixa 1" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit">Criar e usar este caixa</Button>
          </form>
        )}
        <Button variant="ghost" className="mt-4" onClick={onExit}>
          Voltar
        </Button>
      </Card>
    </main>
  );
}

function OpenSession({
  handle,
  onOpened,
  onExit,
}: {
  handle: RegisterHandle;
  onOpened: () => void;
  onExit: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = text.trim() === '' ? 0 : parseBRL(text);
    if (cents === null || cents < 0) return setError('Valor inválido. Use o formato 100,00');
    try {
      await handle.pdv.openSession(cents);
      onOpened();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <h1 className="text-2xl font-bold">Abrir o caixa</h1>
        <p className="mb-4 mt-1 text-muted">
          {handle.context.terminal.name} · {handle.context.storeName}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField
            label="Dinheiro na gaveta para troco (R$)"
            inputMode="decimal"
            placeholder="0,00"
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error}
            hint={text && parseBRL(text) !== null ? `Abertura com ${brl(parseBRL(text)!)}` : 'Pode deixar em branco se não houver troco.'}
            autoFocus
          />
          <Button type="submit" size="lg">
            Abrir caixa
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Voltar
          </Button>
        </form>
      </Card>
    </main>
  );
}

