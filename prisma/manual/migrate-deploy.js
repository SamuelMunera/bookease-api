// Steady-state migration runner for Vercel deploys. The ledger is now
// reconciled (see resolve-ledger history), so `prisma migrate deploy` applies
// any pending migrations and is a no-op when there are none. Skipped locally
// so `npm install` never touches a database.
//
// It also applies the manual SQL files that the P3009-blocked ledger cannot
// (see prisma/manual/*.sql). These used to require running by hand; missing the
// passwordChangedAt column makes authenticate() 401 every request, so it is now
// applied automatically here. All manual SQL is idempotent.
//
// INF-04: previously this ran on ANY Vercel build (including previews), so
// concurrent preview deploys could mutate the production database. It now runs
// only for the production environment.
const isVercel = !!process.env.VERCEL;
const vercelEnv = process.env.VERCEL_ENV || process.env.VERCEL_TARGET_ENV;
if (!isVercel || vercelEnv !== 'production') {
  process.exit(0);
}

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const manualDir = __dirname;
const schema = path.join(manualDir, '..', 'schema.prisma');

// Run a command inheriting stdio (output streamed to the build log).
function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

// Feed a single SQL statement to `prisma db execute --stdin`. Running one
// statement per call keeps each in autocommit mode (no implicit transaction),
// which is what CREATE INDEX CONCURRENTLY requires.
function execStatement(stmt) {
  execSync(`npx prisma db execute --stdin --schema "${schema}"`, {
    input: `${stmt};\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}

try {
  // 1) Prisma ledger migrations (no-op when none pending).
  run(`npx prisma migrate deploy --schema "${schema}"`);

  // 2) CRITICAL and FIRST: without User.passwordChangedAt the authenticate()
  //    middleware 401s every request. Single idempotent ALTER ... ADD COLUMN
  //    IF NOT EXISTS, safe to run always. Applied before anything that depends
  //    on it. Fatal on failure — the app is broken without this column.
  const pwdFile = path.join(manualDir, '20260705000000_add_password_changed_at.sql');
  run(`npx prisma db execute --file "${pwdFile}" --schema "${schema}"`);

  // 3) Multa por cancelación: columnas de política en Professional + tabla
  //    CancellationFee. SQL idempotente (IF NOT EXISTS / catálogo para FKs).
  //    Fatal: sin la tabla, cancelar citas con multa activada rompería el
  //    flujo de cancelación en producción.
  const feeFile = path.join(manualDir, '20260714000000_cancellation_fee.sql');
  run(`npx prisma db execute --file "${feeFile}" --schema "${schema}"`);

  // 3.5) Fidelización punch-card (plan Estudio): tablas LoyaltyProgram/Card/
  //      Stamp/Reward. SQL idempotente (IF NOT EXISTS / catálogo para FKs), sin
  //      CONCURRENTLY, así que el archivo entero corre como una transacción
  //      implícita sin problema. Fatal: sin las tablas los endpoints /api/loyalty
  //      y el hook de sello en markComplete darían 500 en producción.
  const loyaltyFile = path.join(manualDir, '20260715000000_loyalty.sql');
  run(`npx prisma db execute --file "${loyaltyFile}" --schema "${schema}"`);

  // 4) Performance indexes (non-critical). DECISION ON CONCURRENTLY:
  //    CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and
  //    `prisma db execute --file` sends the whole multi-statement file to
  //    Postgres as a single implicit transaction, which would fail. We keep
  //    CONCURRENTLY (no table lock in production) by splitting the file and
  //    running each statement on its own via --stdin (autocommit). Every
  //    statement is `IF NOT EXISTS`, so re-runs are no-ops.
  //    Best-effort: a failed performance index must not block the deploy or
  //    break the app, so this step warns instead of exiting non-zero.
  try {
    const idxFile = path.join(manualDir, '20260704000000_add_indexes.sql');
    const statements = fs
      .readFileSync(idxFile, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of statements) {
      execStatement(stmt);
    }
  } catch (idxErr) {
    console.warn('[migrate-deploy] index step skipped (non-fatal):', idxErr.message);
  }
} catch (err) {
  console.error('[migrate-deploy] failed:', err.message);
  process.exit(1);
}
