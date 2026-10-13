import {
  applyDisplayPreferences,
  Button,
  Card,
  Checkbox,
  PageHeader,
  parseDisplayPreferences,
  playBeep,
  SelectField,
  type DisplayPreferences,
} from '@bipae/ui';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../context';
import { TwoStepCard } from './two-step';

export const DISPLAY_KEY = 'bipae.display';

export async function loadDisplayPreferences(get: (key: string) => Promise<string | null>) {
  return parseDisplayPreferences(await get(DISPLAY_KEY));
}

export function SettingsPage() {
  const { platform, api, setMe } = useApp();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<DisplayPreferences | null>(null);

  useEffect(() => {
    void loadDisplayPreferences((k) => platform.preferences.get(k)).then(setPrefs);
  }, [platform]);

  const update = async (patch: Partial<DisplayPreferences>) => {
    if (!prefs) return;
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyDisplayPreferences(next, document.documentElement);
    await platform.preferences.set(DISPLAY_KEY, JSON.stringify(next));
  };

  if (!prefs) return null;
  return (
    <>
      <PageHeader title="Configurações" />
      <Card className="max-w-xl">
        <h2 className="mb-4 text-lg font-bold">Aparência e acessibilidade</h2>
        <div className="flex flex-col gap-4">
          <SelectField
            label="Tema"
            value={prefs.theme}
            onChange={(e) => void update({ theme: e.target.value as DisplayPreferences['theme'] })}
            options={[
              { value: 'system', label: 'Igual ao sistema' },
              { value: 'light', label: 'Claro' },
              { value: 'dark', label: 'Escuro' },
            ]}
          />
          <Checkbox
            label="Alto contraste"
            checked={prefs.highContrast}
            onChange={(v) => void update({ highContrast: v })}
          />
          <Checkbox
            label="Letras maiores"
            checked={prefs.largeFont}
            onChange={(v) => void update({ largeFont: v })}
          />
          <Checkbox
            label='Som de "bip" a cada venda'
            hint="Um bip curto confirma que a venda foi registrada."
            checked={prefs.beep}
            onChange={(v) => {
              void update({ beep: v });
              playBeep(v);
            }}
          />
        </div>
      </Card>
      <TwoStepCard />
      <Button
        variant="secondary"
        className="mt-6 md:hidden"
        onClick={async () => {
          await api.logout();
          setMe(null);
          navigate('/entrar');
        }}
      >
        Sair
      </Button>
    </>
  );
}
