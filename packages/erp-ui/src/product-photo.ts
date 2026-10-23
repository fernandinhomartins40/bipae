import { PRODUCT_IMAGE_MAX_SIDE, PRODUCT_IMAGE_TARGET_BYTES } from '@bipae/domain';

/**
 * Preparo da foto do produto na tela (F2-14): recorte quadrado no centro (com zoom), redução
 * para no máximo 512×512 e compressão em WebP (ou JPEG, se o navegador não gerar WebP) até
 * cerca de 80 KB. Tudo acontece no aparelho; a API só recebe a foto pronta.
 */

export const NOT_AN_IMAGE = 'Esse arquivo não é uma foto. Escolha uma imagem (JPG, PNG ou WebP).';
export const UNREADABLE_IMAGE =
  'Não deu para abrir essa foto. Tente outra ou tire um print dela e cole aqui.';
/** Arquivo grande demais até para abrir (antes de reduzir). */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Confere o arquivo antes de abrir: precisa ser imagem e de um tamanho razoável. */
export function checkPhotoFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return NOT_AN_IMAGE;
  if (file.size === 0) return NOT_AN_IMAGE;
  if (file.size > MAX_SOURCE_BYTES) return 'Essa foto passa de 25 MB. Escolha uma menor.';
  return null;
}

export interface CropRect {
  x: number;
  y: number;
  side: number;
}

/** Quadrado no centro da foto; `zoom` (1 a 3) aproxima, cortando as bordas. */
export function centeredSquare(width: number, height: number, zoom = 1): CropRect {
  const z = Math.min(3, Math.max(1, zoom));
  const side = Math.max(1, Math.round(Math.min(width, height) / z));
  return { x: Math.round((width - side) / 2), y: Math.round((height - side) / 2), side };
}

/** Lado da foto final: no máximo 512, sem aumentar foto pequena. */
export function outputSide(cropSide: number, max = PRODUCT_IMAGE_MAX_SIDE): number {
  return Math.max(1, Math.min(max, Math.round(cropSide)));
}

/** Qualidades e tamanhos tentados, do melhor para o mais leve, até caber no alvo. */
export const COMPRESSION_STEPS: { scale: number; quality: number }[] = [
  { scale: 1, quality: 0.85 },
  { scale: 1, quality: 0.75 },
  { scale: 1, quality: 0.62 },
  { scale: 1, quality: 0.5 },
  { scale: 0.75, quality: 0.6 },
  { scale: 0.5, quality: 0.6 },
  { scale: 0.5, quality: 0.45 },
];

/** Abre a imagem (arquivo, colada ou da câmera) num elemento que o canvas consegue desenhar. */
export function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth === 0 || img.naturalHeight === 0) reject(new Error(UNREADABLE_IMAGE));
      else resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(UNREADABLE_IMAGE));
    };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Recorta e reduz. Tenta WebP; se o navegador entregar outro formato (Safari antigo entrega PNG),
 * usa JPEG. Diminui a qualidade (e depois o tamanho) até ficar com cerca de 80 KB.
 */
export async function preparePhoto(
  img: HTMLImageElement,
  zoom: number,
  target = PRODUCT_IMAGE_TARGET_BYTES,
): Promise<Blob> {
  const crop = centeredSquare(img.naturalWidth, img.naturalHeight, zoom);
  const side = outputSide(crop.side);
  let type: 'image/webp' | 'image/jpeg' = 'image/webp';
  let best: Blob | null = null;
  for (const step of COMPRESSION_STEPS) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.max(1, Math.round(side * step.scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(UNREADABLE_IMAGE);
    // Fundo branco: PNG transparente não vira fundo preto no JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, type, step.quality);
    if (blob && blob.type !== type) {
      type = 'image/jpeg';
      blob = await toBlob(canvas, type, step.quality);
    }
    if (!blob) throw new Error(UNREADABLE_IMAGE);
    best = blob;
    if (blob.size <= target) break;
  }
  return best!;
}

/** Bytes da foto em base64, sem o prefixo `data:`, para enviar à API. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(UNREADABLE_IMAGE));
    reader.readAsDataURL(blob);
  });
}

/** Primeira imagem de uma colagem (Ctrl+V) ou de um arrastar e soltar. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  const file = data.files?.[0];
  return file ?? null;
}
