import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { migrate } from './db/migrate';

const config = loadConfig();
const database = await openDatabase(config.DATABASE_URL);
const ran = await migrate(database);
if (ran.length > 0) console.log(`Migrações aplicadas: ${ran.join(', ')}`);

const app = await createApp(config, database);
await app.listen({ port: config.PORT, host: config.HOST });
console.log(`Bipaê API em http://localhost:${config.PORT}/v1 (banco: ${database.kind})`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await database.close();
    process.exit(0);
  });
}
