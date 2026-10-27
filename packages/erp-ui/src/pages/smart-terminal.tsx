import {
  SMART_ACQUIRER_IDS,
  SMART_ACQUIRERS,
  smartTerminalMissing,
  type SmartAcquirerId,
  type SmartTerminalConfig,
  type SmartTerminalStatus,
} from '@bipae/platform';
import { Alert, Badge, Button, Card, SelectField, TextField } from '@bipae/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../context';

const KEY = 'bipae.smartTerminal.v1';

/** Lê a escolha da maquininha deste aparelho; o que estiver estragado vira "nenhuma". */
export async function loadSmartTerminalConfig(preferences: {
  get(key: string): Promise<string | null>;
}): Promise<SmartTerminalConfig> {
  try {
    const raw = await preferences.get(KEY);
    const parsed = raw ? (JSON.parse(raw) as SmartTerminalConfig) : null;
    if (parsed && (parsed.acquirer === 'none' || parsed.acquirer in SMART_ACQUIRERS)) return parsed;
  } catch {
    // preferência estragada: começa de novo
  }
  return { acquirer: 'none' };
}

/** Grava só o que não é secreto: o segredo vai direto ao plugin e fica no Keystore do Android. */
export async function saveSmartTerminalConfig(
  preferences: { set(key: string, value: string): Promise<void> },
  config: SmartTerminalConfig,
): Promise<void> {
  const info = config.acquirer === 'none' ? null : SMART_ACQUIRERS[config.acquirer];
  const values = Object.fromEntries(
    Object.entries(config.values ?? {}).filter(
      ([key]) => !info?.fields.find((f) => f.key === key)?.secret,
    ),
  );
  await preferences.set(KEY, JSON.stringify({ acquirer: config.acquirer, values }));
}

/**
 * Maquininha smart ou TEF neste aparelho Android (F8-12): escolhe a adquirente e mostra o que
 * falta. Só aparece quando o app tem a ponte para o plugin Kotlin. Cada adquirente fica em
 * "falta configurar" até ter SDK, conta e aparelho (E26); nada aqui finge que funciona.
 */
export function SmartTerminalSettings() {
  const { platform } = useApp();
  const bridge = platform.smartTerminal;
  const [config, setConfig] = useState<SmartTerminalConfig | null>(null);
  const [status, setStatus] = useState<SmartTerminalStatus | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const acquirer = config?.acquirer;
  useEffect(() => {
    void loadSmartTerminalConfig(platform.preferences).then(setConfig);
  }, [platform]);
  useEffect(() => {
    const ask =
      bridge && acquirer && acquirer !== 'none'
        ? bridge.status(acquirer).catch(() => null)
        : Promise.resolve(null);
    void ask.then(setStatus);
  }, [bridge, acquirer]);

  if (!bridge || !config) return null;
  const info = config.acquirer === 'none' ? null : SMART_ACQUIRERS[config.acquirer];
  const missing = smartTerminalMissing(config, status);
  const values = config.values ?? {};

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (config.acquirer !== 'none' && status?.sdkPresent)
        await bridge.configure(config.acquirer, values);
      await saveSmartTerminalConfig(platform.preferences, config);
      // O segredo já foi ao plugin: limpa o campo e não guarda no Bipaê.
      setConfig({
        ...config,
        values: Object.fromEntries(
          Object.entries(values).filter(([k]) => !info?.fields.find((f) => f.key === k)?.secret),
        ),
      });
      setMessage({ ok: true, text: 'Maquininha salva neste aparelho.' });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  };

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Maquininha neste aparelho</h2>
        {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
        <SelectField
          label="Adquirente"
          value={config.acquirer}
          onChange={(e) => {
            setMessage(null);
            setConfig({ acquirer: e.target.value as SmartAcquirerId | 'none' });
          }}
          options={[
            { value: 'none', label: 'Nenhuma (cartão na maquininha à parte)' },
            ...SMART_ACQUIRER_IDS.map((id) => ({ value: id, label: SMART_ACQUIRERS[id].name })),
          ]}
        />
        {info && (
          <>
            <p className="text-sm text-muted">
              {info.kind === 'smart'
                ? 'A maquininha é o próprio aparelho: o app Bipaê roda nela.'
                : 'O aparelho conversa com um pinpad pelo servidor TEF.'}{' '}
              Chega em breve: ainda não vem com o SDK {info.sdk}.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {info.fields.map((f) => (
                <TextField
                  key={f.key}
                  label={f.label}
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={values[f.key] ?? ''}
                  onChange={(e) =>
                    setConfig({ ...config, values: { ...values, [f.key]: e.target.value } })
                  }
                />
              ))}
            </div>
            {missing.length > 0 ? (
              <Alert tone="warning" title="Falta configurar">
                <ul className="list-disc pl-5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                  {info.needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Alert>
            ) : (
              <Badge tone="success">Pronta para usar</Badge>
            )}
          </>
        )}
        <Button type="submit">Salvar maquininha</Button>
      </form>
    </Card>
  );
}
