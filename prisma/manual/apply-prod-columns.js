// Applies the additive theme + appointment-verification columns on Vercel
// builds. Prod's migration ledger is blocked by a pre-existing failed
// migration (20260503000002_schedule_part_time -> Prisma P3009), so
// `prisma migrate deploy` cannot run. Instead we apply the columns
// idempotently with `ADD COLUMN IF NOT EXISTS`. No-op outside Vercel so
// local `npm install` never touches a database.
if (!process.env.VERCEL) {
  process.exit(0);
}

const { execSync } = require('child_process');
const path = require('path');

const schema = path.join(__dirname, '..', 'schema.prisma');
const file = path.join(__dirname, 'add_theme_apptverify.sql');

try {
  execSync(`npx prisma db execute --schema "${schema}" --file "${file}"`, {
    stdio: 'inherit',
  });
  console.log('[apply-prod-columns] theme/appt-verify columns ensured.');
} catch (err) {
  console.error('[apply-prod-columns] failed:', err.message);
  process.exit(1);
}
