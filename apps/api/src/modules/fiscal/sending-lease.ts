import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { fiscalDocuments } from '../../db/schema';

/**
 * Reserva do envio da nota à SEFAZ (PIE ACH-20). A conversa com a SEFAZ leva até 30 s por chamada
 * (consulta e envio), então 2 minutos sobram; reserva abandonada vence e a varredura retoma.
 */
export const SENDING_LEASE_MS = 2 * 60_000;

/** Lê a nota travando a linha: duas emissões ao mesmo tempo esperam uma pela outra aqui. */
export async function lockDocument(tx: Tx, id: string) {
  const [doc] = await tx
    .select()
    .from(fiscalDocuments)
    .where(eq(fiscalDocuments.id, id))
    .for('update');
  return doc;
}

/** Outra emissão está mandando esta nota agora? */
export function beingSent(doc: { sendingUntil: Date | null }, now = new Date()) {
  return doc.sendingUntil !== null && doc.sendingUntil > now;
}

/** Reserva a nota para quem vai mandar, na mesma transação que a travou. */
export async function claimSending(tx: Tx, id: string, now = new Date()) {
  await tx
    .update(fiscalDocuments)
    .set({ sendingUntil: new Date(now.getTime() + SENDING_LEASE_MS) })
    .where(eq(fiscalDocuments.id, id));
}
