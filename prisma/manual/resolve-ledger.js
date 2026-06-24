// One-shot ledger reconciliation, run on Vercel only.
// Prod's _prisma_migrations had `20260503000002_schedule_part_time` marked as
// FAILED (P3009), even though its columns (idempotent ADD COLUMN IF NOT EXISTS)
// are actually present. And `20260624220700_theme_apptverify` was applied
// manually via `prisma db execute`, so it was never recorded. Mark both as
// applied so the ledger matches reality and `prisma migrate deploy` works again.
// Each resolve is best-effort: if already recorded, it errors harmlessly and we
// continue without failing the build.
if (!process.env.VERCEL) {
  process.exit(0);
}

const { execSync } = require('child_process');
const path = require('path');
const schema = path.join(__dirname, '..', 'schema.prisma');

const migrations = [
  '20260503000002_schedule_part_time',
  '20260624220700_theme_apptverify',
];

for (const name of migrations) {
  try {
    execSync(`npx prisma migrate resolve --applied ${name} --schema "${schema}"`, {
      stdio: 'inherit',
    });
    console.log(`[resolve-ledger] marked applied: ${name}`);
  } catch (err) {
    console.log(`[resolve-ledger] skip ${name} (already recorded or not pending)`);
  }
}
