-- Idempotent application of theme + appointment-verification columns.
-- Applied via `prisma db execute` at Vercel build time, bypassing the
-- migration ledger (prod has a pre-existing failed migration that blocks
-- `prisma migrate deploy` with P3009). Safe to run repeatedly.
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "themeLight" JSONB;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "themeDark" JSONB;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "apptVerifyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "apptVerifyHoursBefore" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "verificationSentAt" TIMESTAMP(3);
