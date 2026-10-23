import { describe, expect, it } from 'vitest';
import { productImageInput, productImagePath, sniffImageType } from './product-images';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

describe('foto do produto (F2-14)', () => {
  it('reconhece WebP, JPEG e PNG pelos primeiros bytes', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0))).toBe('image/jpeg');
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), 0))).toBe(
      'image/webp',
    );
  });

  it('recusa o que não é foto aceita', () => {
    expect(sniffImageType(bytes(...ascii('%PDF-1.4')))).toBeNull();
    expect(sniffImageType(bytes(...ascii('GIF89a')))).toBeNull();
    expect(sniffImageType(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });

  it('valida o envio: tipo aceito, base64 e tamanho, com mensagens em português', () => {
    expect(
      productImageInput.safeParse({ contentType: 'image/webp', data: 'UklGRgAAAABXRUJQ' }).success,
    ).toBe(true);
    const gif = productImageInput.safeParse({ contentType: 'image/gif', data: 'R0lGODlhAQAB' });
    expect(gif.error?.issues[0]?.message).toBe('Envie a foto em WebP, JPEG ou PNG.');
    const junk = productImageInput.safeParse({ contentType: 'image/jpeg', data: 'não é base64!' });
    expect(junk.error?.issues[0]?.message).toBe('A foto chegou corrompida. Tente de novo.');
    const big = productImageInput.safeParse({
      contentType: 'image/jpeg',
      data: 'A'.repeat(300_000),
    });
    expect(big.error?.issues[0]?.message).toBe('A foto passou de 200 KB. Escolha outra.');
  });

  it('o endereço da foto leva o hash, para o cache do navegador', () => {
    expect(productImagePath('p1', 'abc')).toBe('/products/p1/image?v=abc');
  });
});
