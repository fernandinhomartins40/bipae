import { describe, expect, it, vi } from 'vitest';
import { baselineCapabilities, explainCapability } from './capabilities';
import { browserBarcodeCamera, supportsBarcodeCamera } from './barcode-camera';
import { SimulatedBarcodeCamera } from './simulators';

describe('câmera como leitor de código (F8-05)', () => {
  it('só diz que funciona quando o aparelho lê código', () => {
    const sem = baselineCapabilities('web', { connectorPaired: false, webSerial: false });
    expect(sem.barcodeCamera).toEqual({ available: false, reason: 'browser-unsupported' });
    const com = baselineCapabilities('desktop', {
      connectorPaired: false,
      webSerial: false,
      camera: true,
    });
    expect(com.barcodeCamera).toEqual({ available: true, via: 'browser' });
  });

  it('explica em linguagem simples onde funciona e o que fazer aqui', () => {
    const e = explainCapability(
      'barcodeCamera',
      { available: false, reason: 'browser-unsupported' },
      'web',
    );
    expect(e?.message).toContain('Chrome do celular Android');
    expect(e?.message).toContain('digite o código');
  });

  it('no Node não há câmera', () => {
    expect(supportsBarcodeCamera()).toBe(false);
  });
});

describe('câmera do navegador (F8-05)', () => {
  it('liga a câmera traseira, entrega cada código uma vez e desliga tudo', async () => {
    vi.useFakeTimers();
    const frames = [
      [],
      [{ rawValue: '78912342' }],
      [{ rawValue: '78912342' }],
      [{ rawValue: '7891' }],
    ];
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    const g = globalThis as Record<string, unknown>;
    const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { mediaDevices: { getUserMedia } },
      configurable: true,
    });
    g.BarcodeDetector = class {
      constructor(readonly options: { formats: string[] }) {}
      async detect() {
        return frames.shift() ?? [];
      }
    };
    try {
      expect(supportsBarcodeCamera()).toBe(true);
      const camera = browserBarcodeCamera()!;
      const video = {
        srcObject: null as unknown,
        play: vi.fn(async () => {}),
        setAttribute: vi.fn(),
      };
      const codes: string[] = [];
      const off = await camera.start(video, (c) => codes.push(c));
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      expect(video.play).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      // O mesmo código logo em seguida é a mesma bipada.
      expect(codes).toEqual(['78912342', '7891']);
      off();
      expect(stop).toHaveBeenCalled();
      expect(video.srcObject).toBeNull();
    } finally {
      delete g.BarcodeDetector;
      if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
      vi.useRealTimers();
    }
  });

  it('sem leitor de código no navegador, não há câmera', () => {
    expect(browserBarcodeCamera()).toBeUndefined();
  });
});

describe('câmera simulada (para os testes das telas)', () => {
  it('entrega o código mostrado só enquanto está ligada', async () => {
    const camera = new SimulatedBarcodeCamera();
    const codes: string[] = [];
    const off = await camera.start(
      { srcObject: null, play: async () => {}, setAttribute: () => {} },
      (c) => codes.push(c),
    );
    expect(camera.active).toBe(true);
    camera.show('123');
    off();
    camera.show('456');
    expect(codes).toEqual(['123']);
    expect(camera.active).toBe(false);
  });
});
