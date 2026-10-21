import { describe, expect, it } from 'vitest';
import {
  baselineCapabilities,
  explainCapability,
  implementedCapabilities,
  SaleInProgressError,
} from './index';
import {
  createSimulatedPlatform,
  MemoryPreferences,
  SimulatedScale,
  SimulatedUpdater,
} from './simulators';

describe('capabilities', () => {
  it('desktop has everything natively', () => {
    const caps = baselineCapabilities('desktop', { connectorPaired: false, webSerial: false });
    // A câmera depende do WebView (lê no Android, não no Windows): fica de fora da conta.
    const { barcodeCamera, ...native } = caps;
    expect(Object.values(native).every((c) => c.available)).toBe(true);
    expect(barcodeCamera.available).toBe(false);
  });

  it('web without connector: browser print, scale missing, A1 on server', () => {
    const caps = baselineCapabilities('web', { connectorPaired: false, webSerial: false });
    expect(caps.printer).toEqual({ available: true, via: 'browser' });
    expect(caps.scale).toEqual({ available: false, reason: 'needs-connector' });
    expect(caps.cashDrawer.available).toBe(false);
    expect(caps.certificateA1).toEqual({ available: true, via: 'server' });
  });

  it('web uses WebSerial for the scale when the browser supports it', () => {
    const caps = baselineCapabilities('web', { connectorPaired: false, webSerial: true });
    expect(caps.scale).toEqual({ available: true, via: 'browser' });
  });

  it('web with connector paired gets peripherals via connector', () => {
    const caps = baselineCapabilities('web', { connectorPaired: true, webSerial: false });
    expect(caps.scale).toEqual({ available: true, via: 'connector' });
    expect(caps.certificateA3).toEqual({ available: true, via: 'connector' });
    expect(caps.printer).toEqual({ available: true, via: 'connector' });
  });

  it('explains missing capabilities in plain pt-BR with a fix', () => {
    const explanation = explainCapability(
      'scale',
      { available: false, reason: 'needs-connector' },
      'web',
    );
    expect(explanation?.message).toContain(
      'Para usar a balança no navegador, instale o Bipaê Conector',
    );
    expect(explanation?.action?.kind).toBe('install-connector');
    expect(explainCapability('scale', { available: true, via: 'native' }, 'desktop')).toBeNull();
  });

  it('uses the right article for each capability', () => {
    const gap = { available: false as const, reason: 'needs-connector' as const };
    expect(explainCapability('tef', gap, 'web')?.message).toContain('Para usar o TEF / pinpad');
    expect(explainCapability('certificateA3', gap, 'web')?.message).toContain(
      'o certificado digital A3',
    );
  });

  it('reports supported-but-unbuilt capabilities as coming soon', () => {
    const caps = implementedCapabilities(
      baselineCapabilities('web', { connectorPaired: false, webSerial: true }),
      ['printer', 'certificateA1'],
    );
    expect(caps.printer.available).toBe(true);
    expect(caps.storage).toEqual({ available: false, reason: 'coming-soon' });
    expect(caps.cashDrawer).toEqual({ available: false, reason: 'needs-connector' });
    expect(explainCapability('storage', caps.storage, 'web')?.title).toBe('Chega em breve');
  });

  it.each(['browser-unsupported', 'not-configured', 'offline', 'coming-soon'] as const)(
    'has an explanation for %s',
    (reason) => {
      const web = explainCapability('printer', { available: false, reason }, 'web');
      const desktop = explainCapability('printer', { available: false, reason }, 'desktop');
      expect(web?.title.length).toBeGreaterThan(0);
      expect(desktop?.message.length).toBeGreaterThan(0);
    },
  );
});

describe('simulators', () => {
  it('records print jobs and drawer openings', async () => {
    const platform = createSimulatedPlatform('desktop');
    await platform.printer.print({ kind: 'text', data: ['Bipou? Bipaê!'] });
    await platform.cashDrawer.open();
    expect(platform.printer.jobs).toHaveLength(1);
    expect(platform.cashDrawer.opened).toBe(1);
    expect((await platform.capabilities()).printer.available).toBe(true);
    await platform.notifications.notify('Oi', 'Teste');
    expect(platform.notifications.sent).toHaveLength(1);
  });

  it('scale reports placed weight and rejects invalid values', async () => {
    const scale = new SimulatedScale();
    scale.place(1250);
    expect(await scale.read()).toEqual({ grams: 1250, stable: true });
    expect(() => scale.place(-1)).toThrow(RangeError);
  });

  it('TEF approves and declines deterministically', async () => {
    const { tef } = createSimulatedPlatform();
    const ok = await tef.pay({ amountCents: 1000, method: 'debit', saleId: 's1' });
    expect(ok.approved).toBe(true);
    expect(ok.nsu).toBe('000001');
    const declined = await tef.pay({ amountCents: 1013, method: 'credit', saleId: 's2' });
    expect(declined.approved).toBe(false);
    expect((await tef.cancel('000001')).approved).toBe(true);
  });

  it('updater never installs during a sale', async () => {
    const updater = new SimulatedUpdater({ version: '1.1.0', channel: 'stable' });
    expect(await updater.check()).toMatchObject({ version: '1.1.0' });
    await expect(updater.install({ saleInProgress: true })).rejects.toBeInstanceOf(
      SaleInProgressError,
    );
    await updater.install({ saleInProgress: false });
    expect(updater.installed?.version).toBe('1.1.0');
    expect(await updater.check()).toBeNull();
  });

  it('memory preferences round-trip', async () => {
    const prefs = new MemoryPreferences();
    await prefs.set('a', '1');
    expect(await prefs.get('a')).toBe('1');
    await prefs.remove('a');
    expect(await prefs.get('a')).toBeNull();
  });
});
