import { Alert, Badge, Button, Card, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useState, type FormEvent } from 'react';
import { useApp, useMe } from '../context';

/**
 * Verificação em duas etapas (F1-01): opcional, recomendada para donos e gerentes. Ativar pede
 * a leitura do QR e um código; desativar também pede um código, para que uma sessão esquecida
 * aberta não baste para remover a proteção.
 */
export function TwoStepCard() {
  const { api } = useApp();
  const me = useMe();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ['totp'],
    queryFn: () => api.get<{ enabled: boolean }>('/auth/totp'),
  });
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // In a Bipaê support session the client's 2FA is off-limits (the API refuses too).
  if (me.support) return null;
  const manages = me.permissions.includes('admin.users');

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      setNotice(null);
      const s = await api.post<{ secret: string; uri: string }>('/auth/totp/setup');
      setSetup({ secret: s.secret, qr: await QRCode.toDataURL(s.uri, { margin: 1, width: 200 }) });
      setCode('');
    });

  const finish = (path: 'enable' | 'disable', message: string) => (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.post(`/auth/totp/${path}`, { code });
      await queryClient.invalidateQueries({ queryKey: ['totp'] });
      setSetup(null);
      setTurningOff(false);
      setCode('');
      setNotice(message);
    });
  };

  const codeField = (
    <TextField
      label="Código de 6 dígitos"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      autoFocus
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
    />
  );

  return (
    <Card className="mt-6 max-w-xl">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">Verificação em duas etapas</h2>
        {status.data &&
          (status.data.enabled ? <Badge tone="success">Ativa</Badge> : <Badge>Desativada</Badge>)}
      </div>
      <p className="text-muted">
        Além da senha, o Bipaê pede um código do aplicativo autenticador do seu celular (Google
        Authenticator, Microsoft Authenticator ou similar).
        {manages && !status.data?.enabled && ' Recomendado para quem é dono ou gerente.'}
      </p>
      {notice && (
        <div className="mt-3">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {status.data && !status.data.enabled && !setup && (
        <Button className="mt-4" onClick={() => void start()} loading={busy}>
          Ativar verificação em duas etapas
        </Button>
      )}

      {setup && (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={finish('enable', 'Pronto! A partir de agora o Bipaê pede o código ao entrar.')}
        >
          <ol className="list-inside list-decimal space-y-1">
            <li>Abra o aplicativo autenticador no celular.</li>
            <li>Leia o código QR abaixo.</li>
            <li>Digite o código de 6 dígitos que aparecer.</li>
          </ol>
          <div className="flex flex-col items-center gap-2">
            <img
              src={setup.qr}
              alt="Código QR para o aplicativo autenticador"
              width={200}
              height={200}
            />
            <p className="text-sm text-muted">
              Sem câmera? Digite esta chave no aplicativo:{' '}
              <code className="font-mono font-semibold" data-testid="totp-secret">
                {setup.secret}
              </code>
            </p>
          </div>
          {codeField}
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Ativar
            </Button>
            <Button variant="ghost" onClick={() => setSetup(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {status.data?.enabled && !turningOff && (
        <Button variant="secondary" className="mt-4" onClick={() => setTurningOff(true)}>
          Desativar
        </Button>
      )}
      {turningOff && (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={finish('disable', 'Verificação em duas etapas desativada.')}
        >
          <p>Para desativar, confirme com um código do aplicativo.</p>
          {codeField}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={code.length !== 6}>
              Desativar
            </Button>
            <Button variant="ghost" onClick={() => setTurningOff(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <p className="mt-4 text-sm text-muted">
        Perdeu o celular? Fale com o suporte Bipaê: depois de confirmar quem é você, liberamos o
        acesso.
      </p>
    </Card>
  );
}
