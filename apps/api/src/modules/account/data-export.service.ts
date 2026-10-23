import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { RequestContext } from '../../common/auth';
import { DB } from '../../common/di';
import { createZip } from '../../common/zip';
import { withTenant, type Db } from '../../db/client';
import { rowsOf } from '../../db/migrate';
import { AuditService } from '../audit/audit.service';

/** Tabelas com tenant_id que são registros da plataforma, não dados do cliente. */
const PLATFORM_TABLES = new Set(['tenant_events', 'platform_audit_log']);
/** Colunas que nunca saem na exportação: senhas, segredos, tokens e chaves. */
const SECRET_COLUMN = /(hash|secret|password|token|pfx|private|sealed|totp|cipher|key_enc)/i;
const SAFE_NAME = /^[a-z_][a-z0-9_]*$/;

/** Tabelas do cliente (com tenant_id), em ordem alfabética. */
export async function tenantTables(execute: (query: ReturnType<typeof sql>) => Promise<unknown>) {
  const result = await execute(sql`
    select c.table_name as name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
    order by c.table_name`);
  return rowsOf<{ name: string }>(result)
    .map((r) => r.name)
    .filter((name) => SAFE_NAME.test(name) && !PLATFORM_TABLES.has(name));
}

/**
 * Exportação dos dados do cliente (LGPD, P-03): um ZIP com um JSON por tabela, só com os dados
 * desta conta (o isolamento por cliente garante isso) e sem segredos. Fica na auditoria.
 */
@Injectable()
export class DataExportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async export(ctx: RequestContext): Promise<{ fileName: string; zip: Buffer }> {
    const exportedAt = new Date();
    const files = await withTenant(this.db, ctx, async (tx) => {
      const out: { name: string; data: string }[] = [];
      const counts: Record<string, number> = {};
      for (const table of await tenantTables((q) => tx.execute(q))) {
        const rows = rowsOf<Record<string, unknown>>(
          await tx.execute(sql`select * from ${sql.identifier(table)} order by 1`),
        ).map((row) =>
          Object.fromEntries(
            Object.entries(row)
              .filter(([column]) => !SECRET_COLUMN.test(column))
              // Bytes (a foto do produto, F2-14) saem em base64, não como lista de números.
              .map(([column, value]) => [
                column,
                value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value,
              ]),
          ),
        );
        counts[table] = rows.length;
        out.push({ name: `${table}.json`, data: JSON.stringify(rows, null, 2) });
      }
      // Pessoas da equipe: nome e e-mail (sem senha nem segredo da verificação em duas etapas).
      const people = rowsOf<Record<string, unknown>>(
        await tx.execute(sql`
          select u.id, u.name, u.email, u.created_at
          from users u join memberships m on m.user_id = u.id
          order by u.name`),
      );
      out.push({ name: 'users.json', data: JSON.stringify(people, null, 2) });
      out.unshift({
        name: 'leia-me.txt',
        data: [
          'Dados exportados do Bipaê',
          `Data: ${exportedAt.toISOString()}`,
          '',
          'Cada arquivo .json é uma tabela, com os registros desta conta.',
          'Valores em dinheiro estão em centavos (ex.: 1234 = R$ 12,34).',
          'Senhas, segredos e certificados digitais não são exportados.',
          '',
          'Notas fiscais: guarde os XML pelo prazo da lei (5 anos), mesmo depois de cancelar a conta.',
        ].join('\n'),
      });
      await this.audit.record(tx, ctx, {
        action: 'account.data_exported',
        entity: 'tenant',
        entityId: ctx.tenantId,
        data: { tables: counts },
      });
      return out;
    });
    const stamp = exportedAt.toISOString().slice(0, 10);
    return { fileName: `bipae-dados-${stamp}.zip`, zip: createZip(files, exportedAt) };
  }
}
