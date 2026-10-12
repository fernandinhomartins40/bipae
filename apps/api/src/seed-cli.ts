import { seed } from './seed';

await seed(process.env.DATABASE_URL ?? 'pglite://.data/bipae');
