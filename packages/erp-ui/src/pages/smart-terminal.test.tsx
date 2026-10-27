import { SimulatedSmartTerminalBridge, type Platform } from '@bipae/platform';
import { MemoryPreferences } from '@bipae/platform/simulators';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from '../context';
import {
  loadSmartTerminalConfig,
  saveSmartTerminalConfig,
  SmartTerminalSettings,
} from './smart-terminal';

function setup(bridge?: SimulatedSmartTerminalBridge) {
  const preferences = new MemoryPreferences();
  const platform = {
    kind: 'desktop',
    mobile: true,
    version: '1',
    preferences,
    smartTerminal: bridge,
  } as unknown as Platform;
  const view = render(
    <AppContextProvider value={{ platform, api: {} as never, me: null, setMe: () => {} }}>
      <SmartTerminalSettings />
    </AppContextProvider>,
  );
  return { preferences, view };
}

describe('configuração da maquininha no Android (F8-12)', () => {
  it('não aparece sem a ponte do plugin', async () => {
    const { view } = setup(undefined);
    await waitFor(() => expect(view.container.textContent).toBe(''));
  });

  it('mostra "falta configurar" enquanto o SDK não está no app', async () => {
    const user = userEvent.setup();
    setup(new SimulatedSmartTerminalBridge({ sdkPresent: false }));
    await user.selectOptions(await screen.findByLabelText('Adquirente'), 'pagbank');
    expect(await screen.findByText('Falta configurar')).toBeTruthy();
    expect(screen.getAllByText(/SDK PlugPagServiceWrapper/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Chega em breve/)).toBeTruthy();
  });

  it('com tudo pronto mostra pronta, e o segredo vai ao plugin e não às preferências', async () => {
    const user = userEvent.setup();
    const bridge = new SimulatedSmartTerminalBridge();
    const { preferences } = setup(bridge);
    await user.selectOptions(await screen.findByLabelText('Adquirente'), 'cielo');
    await user.type(screen.getByLabelText('Client ID da Cielo'), 'abc');
    await user.type(screen.getByLabelText('Access token da Cielo'), 'segredo');
    expect(await screen.findByText('Pronta para usar')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Salvar maquininha' }));
    expect(await screen.findByText('Maquininha salva neste aparelho.')).toBeTruthy();
    expect(bridge.configured[0]?.values).toEqual({ clientId: 'abc', accessToken: 'segredo' });
    const saved = (await preferences.get('bipae.smartTerminal.v1'))!;
    expect(saved).toContain('abc');
    expect(saved).not.toContain('segredo');
  });

  it('escolher nenhuma limpa o aviso e salvar não chama o plugin', async () => {
    const user = userEvent.setup();
    const bridge = new SimulatedSmartTerminalBridge();
    setup(bridge);
    await user.click(await screen.findByRole('button', { name: 'Salvar maquininha' }));
    expect(await screen.findByText('Maquininha salva neste aparelho.')).toBeTruthy();
    expect(bridge.configured).toEqual([]);
  });

  it('mostra o erro em português quando o plugin recusa', async () => {
    const user = userEvent.setup();
    const bridge = new SimulatedSmartTerminalBridge();
    bridge.configure = async () => {
      throw new Error('Código de ativação inválido.');
    };
    setup(bridge);
    await user.selectOptions(await screen.findByLabelText('Adquirente'), 'stone');
    await user.type(screen.getByLabelText('Stone Code da loja'), '123');
    await screen.findByText('Pronta para usar');
    await user.click(screen.getByRole('button', { name: 'Salvar maquininha' }));
    expect(await screen.findByText('Código de ativação inválido.')).toBeTruthy();
  });

  it('preferência estragada ou desconhecida vira nenhuma', async () => {
    const preferences = new MemoryPreferences();
    await preferences.set('bipae.smartTerminal.v1', '{nao-e-json');
    expect(await loadSmartTerminalConfig(preferences)).toEqual({ acquirer: 'none' });
    await preferences.set('bipae.smartTerminal.v1', JSON.stringify({ acquirer: 'xyz' }));
    expect(await loadSmartTerminalConfig(preferences)).toEqual({ acquirer: 'none' });
    await saveSmartTerminalConfig(preferences, { acquirer: 'none', values: { a: '1' } });
    expect(await loadSmartTerminalConfig(preferences)).toEqual({
      acquirer: 'none',
      values: { a: '1' },
    });
  });
});
