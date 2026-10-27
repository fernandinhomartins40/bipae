import {
  createTefDriver,
  loadTefConfig,
  type Platform,
  type TefDriver,
  type TefStep,
  type TefUi,
} from '@bipae/platform';
import { Alert, Button, Modal, TextField } from '@bipae/ui';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

/**
 * Tela dos passos do pinpad (F8-11.b). O TEF conversa por passos (mensagem, menu, campo, confirmação,
 * espera) e esta tela os mostra num diálogo, devolvendo a resposta do operador. A tela só conhece o
 * protocolo de `@bipae/platform`; nenhum código de periférico entra aqui (regra 9 do CLAUDE.md).
 */
type Screen =
  | { kind: 'message' | 'wait'; text: string; target?: 'operator' | 'customer' | 'both' }
  | { kind: 'menu'; step: Extract<TefStep, { kind: 'menu' }>; done: (v: string | null) => void }
  | { kind: 'input'; step: Extract<TefStep, { kind: 'input' }>; done: (v: string | null) => void }
  | { kind: 'confirm'; step: Extract<TefStep, { kind: 'confirm' }>; done: (v: boolean) => void };

/** Devolve o `TefUi` que o `DriverTefPort` usa, mais o diálogo a desenhar na tela do caixa. */
export function useTefScreen(): { ui: TefUi; dialog: React.ReactNode; close: () => void } {
  const [screen, setScreen] = useState<Screen | null>(null);

  const ui = useMemo<TefUi>(
    () => ({
      show: (step) =>
        setScreen({
          kind: step.kind,
          text: step.text,
          ...('target' in step && { target: step.target }),
        }),
      menu: (step) => new Promise((resolve) => setScreen({ kind: 'menu', step, done: resolve })),
      input: (step) => new Promise((resolve) => setScreen({ kind: 'input', step, done: resolve })),
      confirm: (step) =>
        new Promise((resolve) => setScreen({ kind: 'confirm', step, done: resolve })),
    }),
    [],
  );

  return {
    ui,
    close: () => setScreen(null),
    dialog: screen && <TefDialog screen={screen} />,
  };
}

function TefDialog({ screen }: { screen: Screen }) {
  return (
    <Modal open onOpenChange={() => undefined} title="Cartão no pinpad">
      <div className="flex flex-col gap-4" data-testid="tef-screen">
        {(screen.kind === 'message' || screen.kind === 'wait') && (
          <Alert title={screen.kind === 'wait' ? 'Aguardando o pinpad' : 'Pinpad'}>
            <p className="text-lg" role="status">
              {screen.text}
            </p>
          </Alert>
        )}
        {screen.kind === 'menu' && <MenuStep screen={screen} />}
        {screen.kind === 'input' && <InputStep screen={screen} />}
        {screen.kind === 'confirm' && (
          <>
            <p className="text-lg font-semibold">{screen.step.question}</p>
            <div className="flex gap-2">
              <Button onClick={() => screen.done(true)}>Sim</Button>
              <Button variant="secondary" onClick={() => screen.done(false)}>
                Não
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function MenuStep({ screen }: { screen: Extract<Screen, { kind: 'menu' }> }) {
  return (
    <>
      <p className="text-lg font-semibold">{screen.step.title || 'Escolha uma opção'}</p>
      <div className="flex flex-col gap-2">
        {screen.step.options.map((o) => (
          <Button key={o.value} variant="secondary" onClick={() => screen.done(o.value)}>
            {o.label}
          </Button>
        ))}
      </div>
      <Button variant="ghost" onClick={() => screen.done(null)}>
        Cancelar
      </Button>
    </>
  );
}

function InputStep({ screen }: { screen: Extract<Screen, { kind: 'input' }> }) {
  const { step } = screen;
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.length >= step.minLength) screen.done(value);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <TextField
        label={step.title || 'Informe o dado pedido'}
        type={step.secret ? 'password' : 'text'}
        inputMode={step.format === 'text' ? 'text' : 'numeric'}
        autoComplete="off"
        maxLength={step.maxLength || undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={value.length < step.minLength}>
          Continuar
        </Button>
        <Button type="button" variant="ghost" onClick={() => screen.done(null)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * O driver de TEF configurado neste computador (F8-11), ou null quando o caixa cobra o cartão em
 * maquininha à parte. A configuração vem das preferências; as bibliotecas, do Desktop ou do Conector.
 */
export function useTefDriver(platform: Platform): TefDriver | null {
  const [driver, setDriver] = useState<TefDriver | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const config = await loadTefConfig(platform.preferences);
        const libs =
          config.provider === 'sitef' || config.provider === 'paygo'
            ? await (platform.tefLibs?.libs() ?? Promise.resolve({}))
            : {};
        if (alive) setDriver(createTefDriver(config, libs));
      } catch {
        if (alive) setDriver(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [platform]);
  return driver;
}
