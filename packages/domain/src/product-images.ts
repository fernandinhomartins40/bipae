import { z } from 'zod';

/**
 * Foto do produto (F2-14). A tela reduz a foto antes de enviar (no máximo 512×512, WebP ou JPEG,
 * cerca de 80 KB); o servidor aceita um pouco de folga e confere o tipo pelos primeiros bytes,
 * sem confiar no que o navegador declarou.
 */
export const PRODUCT_IMAGE_MAX_SIDE = 512;
/** Alvo da redução na tela. */
export const PRODUCT_IMAGE_TARGET_BYTES = 80 * 1024;
/** Limite aceito pelo servidor (a tela já entrega bem menos). */
export const PRODUCT_IMAGE_MAX_BYTES = 200 * 1024;

export const PRODUCT_IMAGE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type ProductImageType = (typeof PRODUCT_IMAGE_TYPES)[number];

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export const productImageInput = z.object({
  contentType: z.enum(PRODUCT_IMAGE_TYPES, {
    error: 'Envie a foto em WebP, JPEG ou PNG.',
  }),
  /** Bytes da foto em base64 (sem o prefixo `data:`). */
  data: z
    .string()
    .min(8, 'A foto está vazia.')
    // base64 ocupa 4/3 do tamanho original.
    .max(
      Math.ceil((PRODUCT_IMAGE_MAX_BYTES * 4) / 3) + 4,
      'A foto passou de 200 KB. Escolha outra.',
    )
    .regex(BASE64, 'A foto chegou corrompida. Tente de novo.'),
});
export type ProductImageInput = z.output<typeof productImageInput>;

/** Tipo da imagem pelos primeiros bytes (assinatura do formato); null se não for imagem aceita. */
export function sniffImageType(bytes: Uint8Array): ProductImageType | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a
  )
    return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Endereço da foto na API (sem o `/v1`). O hash entra no endereço: foto nova, endereço novo, então
 * a foto antiga pode ficar guardada no cache do navegador para sempre.
 */
export function productImagePath(productId: string, imageHash: string): string {
  return `/products/${productId}/image?v=${imageHash}`;
}
