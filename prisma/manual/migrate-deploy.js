// Steady-state migration runner for Vercel deploys. The ledger is now
// reconciled (see resolve-ledger history), so `prisma migrate deploy` applies
// any pending migrations and is a no-op when there are none. Skipped locally
// so `npm install` never touches a database.
if (!process.env.VERCEL) {
  process.exit(0);
}

const { execSync } = require('child_process');
const path = require('path');
const schema = path.join(__dirname, '..', 'schema.prisma');

try {
  execSync(`npx prisma migrate deploy --schema "${schema}"`, { stdio: 'inherit' });
} catch (err) {
  console.error('[migrate-deploy] failed:', err.message);
  process.exit(1);
}
