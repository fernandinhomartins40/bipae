import { inflateRawSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatform } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** P-03: exportação dos dados (LGPD) e exclusão definitiva depois do cancelamento. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

function unzip(zip: Buffer) {
  const files: Record<string, string> = {};
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength;
    files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
    at = start + size;
  }
  return files;
}

async function contaComDados() {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  await admin.post('/products', { name: 'Café 500g', priceCents: 1890, barcodes: ['78912342'] });
  await admin.post('/customers', { name: 'Maria', taxId: '52998224725' });
  return { dono, admin, tenantId: dono.me.tenant.id as string };
}

const count = async (table: string, tenantId: string) =>
  asPlatform(t.database.db, async (tx) =>
    Number(
      rowsOf<{ n: string }>(
        await tx.execute(
          sql`select count(*)::text as n from ${sql.identifier(table)} where tenant_id = ${tenantId}`,
        ),
      )[0]!.n,
    ),
  );

describe('dados do cliente (P-03)', () => {
  it('o dono baixa um ZIP com as tabelas da conta, sem senhas nem dados de outro cliente', async () => {
    const { admin, dono } = await contaComDados();
    const outro = await contaComDados();
    await api(t.app, outro.dono.auth).post('/products', {
      name: 'Produto do vizinho',
      priceCents: 100,
    });

    const res = await admin.get('/account/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="bipae-dados-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzip(res.rawPayload);
    expect(files['leia-me.txt']).toContain('Valores em dinheiro estão em centavos');
    expect(JSON.parse(files['products.json']!)).toEqual([
      expect.objectContaining({ name: 'Café 500g', price_cents: 1890 }),
    ]);
    expect(JSON.parse(files['customers.json']!)[0]).toMatchObject({ name: 'Maria' });
    expect(JSON.parse(files['users.json']!)).toEqual([
      expect.objectContaining({ email: dono.me.user.email }),
    ]);
    const tudo = Object.values(files).join('\n');
    expect(tudo).not.toContain('Produto do vizinho');
    expect(tudo).not.toMatch(/password_hash|token_hash|totp_secret/);
    expect(
      JSON.stringify((await admin.get('/audit?action=account.data_exported')).json()),
    ).toContain('account.data_exported');
  });

  it('conta cancelada é excluída de vez só depois do prazo, sem tocar nos outros clientes', async () => {
    const alvo = await contaComDados();
    const vizinho = await contaComDados();
    const cancelar = (diasAtras: number) =>
      asPlatform(t.database.db, (tx) =>
        tx.execute(sql`
          update tenants set status = 'cancelled',
            status_changed_at = now() - make_interval(days => ${diasAtras})
          where id = ${alvo.tenantId}`),
      );
    const manutencao = t.app.get(MaintenanceService);

    await cancelar(10);
    expect(await manutencao.purgeCancelledAccounts()).not.toContain(alvo.tenantId);
    expect(await count('products', alvo.tenantId)).toBe(1);

    await cancelar(91);
    expect(await manutencao.purgeCancelledAccounts()).toContain(alvo.tenantId);
    for (const table of [
      'products',
      'customers',
      'memberships',
      'audit_log',
      'companies',
      'stores',
    ]) {
      expect(await count(table, alvo.tenantId)).toBe(0);
    }
    expect(await count('products', vizinho.tenantId)).toBe(1);
    const [tenant] = await asPlatform(t.database.db, async (tx) =>
      rowsOf<{ name: string; purged_at: string | null }>(
        await tx.execute(sql`select name, purged_at from tenants where id = ${alvo.tenantId}`),
      ),
    );
    expect(tenant).toMatchObject({ name: 'Cliente excluído' });
    expect(tenant!.purged_at).not.toBeNull();
    const pessoas = await asPlatform(t.database.db, async (tx) =>
      rowsOf(await tx.execute(sql`select id from users where id = ${alvo.dono.me.user.id}`)),
    );
    expect(pessoas).toEqual([]);
    const trilha = await asPlatform(t.database.db, async (tx) =>
      rowsOf<{ action: string }>(
        await tx.execute(
          sql`select action from platform_audit_log where tenant_id = ${alvo.tenantId} order by seq desc limit 1`,
        ),
      ),
    );
    expect(trilha[0]?.action).toBe('tenant.purged');
    // Rodar de novo não faz nada: a conta já foi excluída.
    expect(await manutencao.purgeCancelledAccounts()).not.toContain(alvo.tenantId);
  });

  it('a trilha de auditoria continua imutável fora da exclusão definitiva', async () => {
    const { tenantId } = await contaComDados();
    await expect(
      asPlatform(t.database.db, (tx) =>
        tx.execute(sql`delete from audit_log where tenant_id = ${tenantId}`),
      ),
    ).rejects.toThrow();
  });
});
