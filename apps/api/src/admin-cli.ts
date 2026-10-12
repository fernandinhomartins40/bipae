/**
 * Bipaê staff bootstrap (run on the server):
 *   node dist/admin-cli.js grant <email> [owner|support|viewer]
 *   node dist/admin-cli.js revoke <email>
 *   node dist/admin-cli.js reset-totp <email>
 *   node dist/admin-cli.js list
 * The person must already have a Bipaê account (sign up at /app/criar-conta). Every change is
 * written to the platform audit as done by "cli". After this, use the panel (/app/admin).
 */
import { PLATFORM_ROLES, type PlatformRole } from '@bipae/domain';
import { eq, sql } from 'drizzle-orm';
import { loadConfig } from './config';
import { asPlatform, openDatabase } from './db/client';
import { migrate, rowsOf } from './db/migrate';
import { platformAdmins, users } from './db/schema';
import { PlatformAuditService } from './modules/admin/platform-audit.service';

const [command, email, roleArg] = process.argv.slice(2);
const config = loadConfig();
const database = await openDatabase(config.DATABASE_URL);
await migrate(database);
const audit = new PlatformAuditService(database.db);
const cli = { userId: null, ip: 'cli' };

async function findUser(address: string) {
  const result = await asPlatform(database.db, (tx) =>
    tx.execute(sql`select id, name, email from users where lower(email) = lower(${address})`),
  );
  const [user] = rowsOf<{ id: string; name: string; email: string }>(result);
  if (!user) {
    console.error(`Não existe conta com o e-mail ${address}. Crie a conta em /app/criar-conta primeiro.`);
    process.exit(1);
  }
  return user;
}

try {
  switch (command) {
    case 'grant': {
      const role = (roleArg ?? 'owner') as PlatformRole;
      if (!email || !PLATFORM_ROLES.includes(role)) throw new Error('Uso: grant <email> [owner|support|viewer]');
      const user = await findUser(email);
      await asPlatform(database.db, async (tx) => {
        await tx
          .insert(platformAdmins)
          .values({ userId: user.id, role })
          .onConflictDoUpdate({ target: platformAdmins.userId, set: { role, active: true, updatedAt: new Date() } });
        await audit.record(tx, cli, { action: 'admin.granted', target: user.id, data: { email: user.email, role, via: 'cli' } });
      });
      console.log(`${user.email} agora é ${role} da equipe Bipaê. Entre em /app/admin e ative a verificação em duas etapas.`);
      break;
    }
    case 'revoke': {
      if (!email) throw new Error('Uso: revoke <email>');
      const user = await findUser(email);
      await asPlatform(database.db, async (tx) => {
        await tx.update(platformAdmins).set({ active: false, updatedAt: new Date() }).where(eq(platformAdmins.userId, user.id));
        await audit.record(tx, cli, { action: 'admin.updated', target: user.id, data: { active: false, via: 'cli' } });
      });
      console.log(`Acesso ao painel removido de ${user.email}.`);
      break;
    }
    case 'reset-totp': {
      if (!email) throw new Error('Uso: reset-totp <email>');
      const user = await findUser(email);
      await asPlatform(database.db, async (tx) => {
        await tx.update(platformAdmins).set({ totpEnabled: false, totpSecret: null, updatedAt: new Date() }).where(eq(platformAdmins.userId, user.id));
        await audit.record(tx, cli, { action: 'admin.totp_reset', target: user.id, data: { via: 'cli' } });
      });
      console.log(`Verificação em duas etapas zerada para ${user.email}. Ative de novo no próximo acesso.`);
      break;
    }
    case 'list': {
      const rows = await asPlatform(database.db, (tx) =>
        tx
          .select({ email: users.email, role: platformAdmins.role, active: platformAdmins.active, totp: platformAdmins.totpEnabled })
          .from(platformAdmins)
          .innerJoin(users, eq(users.id, platformAdmins.userId)),
      );
      console.table(rows);
      break;
    }
    default:
      console.log('Comandos: grant <email> [owner|support|viewer] · revoke <email> · reset-totp <email> · list');
  }
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  await database.close();
}
