import { describe, expect, it } from 'vitest';
import { noticeText } from './confere-notices';

const base = {
  id: 'n1',
  storeId: 's1',
  documentId: 'doc1',
  invoiceNumber: '12345',
  itemsCount: 12,
  receivedAt: '2026-10-14T08:00:00Z',
};

describe('aviso de nota para conferir (MF-14)', () => {
  it('mostra o fornecedor e o valor da nota', () => {
    expect(noticeText({ ...base, supplierName: 'Distribuidora X', totalCents: 183450 })).toBe(
      'Chegou nota de Distribuidora X (R$ 1.834,50) para conferir',
    );
  });

  it('sem fornecedor nem valor, o texto continua natural', () => {
    expect(noticeText({ ...base, supplierName: null, totalCents: null })).toBe(
      'Chegou nota para conferir',
    );
  });
});
