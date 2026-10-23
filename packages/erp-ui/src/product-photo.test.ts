import { describe, expect, it } from 'vitest';
import {
  centeredSquare,
  checkPhotoFile,
  COMPRESSION_STEPS,
  imageFromTransfer,
  NOT_AN_IMAGE,
  outputSide,
} from './product-photo';

describe('preparo da foto do produto (F2-14)', () => {
  it('recusa o que não é imagem, arquivo vazio e arquivo enorme', () => {
    expect(checkPhotoFile({ type: 'application/pdf', size: 1000 })).toBe(NOT_AN_IMAGE);
    expect(checkPhotoFile({ type: '', size: 1000 })).toBe(NOT_AN_IMAGE);
    expect(checkPhotoFile({ type: 'image/png', size: 0 })).toBe(NOT_AN_IMAGE);
    expect(checkPhotoFile({ type: 'image/jpeg', size: 30 * 1024 * 1024 })).toBe(
      'Essa foto passa de 25 MB. Escolha uma menor.',
    );
    expect(checkPhotoFile({ type: 'image/jpeg', size: 3_000_000 })).toBeNull();
  });

  it('recorta um quadrado no centro, e o zoom aproxima sem sair da foto', () => {
    expect(centeredSquare(4000, 3000)).toEqual({ x: 500, y: 0, side: 3000 });
    expect(centeredSquare(600, 1000)).toEqual({ x: 0, y: 200, side: 600 });
    expect(centeredSquare(1000, 1000, 2)).toEqual({ x: 250, y: 250, side: 500 });
    // Zoom fora da faixa fica entre 1 e 3.
    expect(centeredSquare(900, 900, 10)).toEqual({ x: 300, y: 300, side: 300 });
    expect(centeredSquare(900, 900, 0.2)).toEqual({ x: 0, y: 0, side: 900 });
  });

  it('reduz para no máximo 512 e não aumenta foto pequena', () => {
    expect(outputSide(3000)).toBe(512);
    expect(outputSide(300)).toBe(300);
    expect(outputSide(0)).toBe(1);
  });

  it('as tentativas de compressão vão da melhor para a mais leve', () => {
    const weight = (s: { scale: number; quality: number }) => s.scale * s.scale * s.quality;
    for (let i = 1; i < COMPRESSION_STEPS.length; i++) {
      expect(weight(COMPRESSION_STEPS[i]!)).toBeLessThan(weight(COMPRESSION_STEPS[i - 1]!));
    }
  });

  it('pega a primeira imagem de uma colagem ou de um arrastar', () => {
    const photo = new File(['x'], 'foto.png', { type: 'image/png' });
    const text = { kind: 'string', type: 'text/plain', getAsFile: () => null };
    const image = { kind: 'file', type: 'image/png', getAsFile: () => photo };
    const transfer = (items: unknown[], files: File[] = []) =>
      ({ items, files }) as unknown as DataTransfer;
    expect(imageFromTransfer(transfer([text, image]))).toBe(photo);
    expect(imageFromTransfer(transfer([], [photo]))).toBe(photo);
    expect(imageFromTransfer(transfer([text]))).toBeNull();
    expect(imageFromTransfer(null)).toBeNull();
  });
});
