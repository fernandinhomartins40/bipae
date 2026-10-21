import type { BarcodeCameraPort, CameraVideo } from './ports';

/** O pedaço do BarcodeDetector que usamos (a API ainda não está nos tipos do TypeScript). */
interface Detector {
  detect(source: CameraVideo): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];
/** O mesmo código lido de novo dentro desse tempo é a mesma bipada. */
const REPEAT_MS = 1500;

interface Track {
  stop(): void;
}
interface MediaApi {
  getUserMedia(constraints: unknown): Promise<{ getTracks(): Track[] }>;
}
const browser = globalThis as unknown as {
  BarcodeDetector?: DetectorClass;
  navigator?: { mediaDevices?: MediaApi };
};
const detectorClass = () => browser.BarcodeDetector;
const media = () => browser.navigator?.mediaDevices;

/** O navegador ou o WebView tem câmera e sabe ler código de barras? */
export function supportsBarcodeCamera(): boolean {
  return !!detectorClass() && typeof media()?.getUserMedia === 'function';
}

/** Câmera traseira + BarcodeDetector (Chrome do Android e WebView do app). */
export function browserBarcodeCamera(): BarcodeCameraPort | undefined {
  const Klass = detectorClass();
  if (!Klass || !supportsBarcodeCamera()) return undefined;
  return {
    async start(video, onCode) {
      const stream = await media()!.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play();
      const detector = new Klass({ formats: FORMATS });
      let last = { code: '', at: 0 };
      let stopped = false;
      const tick = async () => {
        if (stopped) return;
        try {
          for (const { rawValue } of await detector.detect(video)) {
            const now = Date.now();
            if (rawValue && (rawValue !== last.code || now - last.at > REPEAT_MS)) {
              last = { code: rawValue, at: now };
              onCode(rawValue);
            }
          }
        } catch {
          // Quadro sem imagem ainda: tenta no próximo.
        }
        if (!stopped) setTimeout(() => void tick(), 200);
      };
      void tick();
      return () => {
        stopped = true;
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
      };
    },
  };
}
