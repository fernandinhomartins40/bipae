import type { Platform } from '@bipae/platform';
import { Alert, Button, Modal, TextField } from '@bipae/ui';
import { useState, type FormEvent } from 'react';

/**
 * Autoatendimento (F5-06): o caixa vira uma tela para o próprio cliente bipar e pagar. O
 * operador liga o modo e escolhe um PIN de atendente; tirar item, confirmar o pagamento e sair
 * do modo pedem esse PIN. O PIN fica só neste aparelho, como hash com sal (nunca em texto puro),
 * e funciona sem internet, como o resto do caixa.
 */
export const SELF_CHECKOUT_PREF = 'bipae.self-checkout';

export interface SelfCheckoutState {
  salt: string;
  hash: string;
}

const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return hex(await crypto.subtle.digest('SHA-256', data));
}

export async function newSelfCheckout(pin: string): Promise<SelfCheckoutState> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  return { salt, hash: await hashPin(pin, salt) };
}

export async function loadSelfCheckout(platform: Platform): Promise<SelfCheckoutState | null> {
  const raw = await platform.preferences.get(SELF_CHECKOUT_PREF).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SelfCheckoutState>;
    return parsed.salt && parsed.hash ? { salt: parsed.salt, hash: parsed.hash } : null;
  } catch {
    return null;
  }
}

export const PIN_PATTERN = /^\d{4,6}$/;

/**
 * Pede o PIN do atendente. Em `create`, o operador escolhe o PIN (duas vezes); em `check`, o
 * atendente confirma uma ação do cliente.
 */
export function PinDialog({
  mode,
  title,
  description,
  state,
  onDone,
  onClose,
}: {
  mode: 'create' | 'check';
  title: string;
  description: string;
  state?: SelfCheckoutState | null;
  onDone: (pin: string) => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!PIN_PATTERN.test(pin)) return setError('O PIN tem de 4 a 6 números.');
    if (mode === 'create') {
      if (pin !== again) return setError('Os dois PINs não são iguais.');
      return onDone(pin);
    }
    setBusy(true);
    const ok = state ? (await hashPin(pin, state.salt)) === state.hash : false;
    setBusy(false);
    if (!ok) {
      setPin('');
      return setError('PIN errado. Chame o atendente.');
    }
    onDone(pin);
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <p className="text-muted">{description}</p>
        {error && <Alert>{error}</Alert>}
        <TextField
          label="PIN do atendente"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
        />
        {mode === 'create' && (
          <TextField
            label="Repita o PIN"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={again}
            onChange={(e) => setAgain(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        )}
        <Button type="submit" loading={busy}>
          {mode === 'create' ? 'Ligar o autoatendimento' : 'Confirmar'}
        </Button>
      </form>
    </Modal>
  );
}
