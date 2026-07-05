-- Manual index migration (A-03).
--
-- WHY MANUAL: the Prisma migration ledger is applied manually in this project
-- (see prisma/manual/migrate-deploy.js and the P3009 history). These indexes
-- MUST be applied by hand against production; the schema.prisma @@index blocks
-- describe the desired state but do NOT create the indexes on their own here.
--
-- HOW TO APPLY (production, one-off): run this file against DIRECT_URL.
--   psql "$DIRECT_URL" -f prisma/manual/20260704000000_add_indexes.sql
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so run
-- each statement autocommit (psql -f does this by default). Index names match
-- Prisma's default naming ({Table}_{cols}_idx) so a future `prisma migrate` sees
-- the schema as already in sync.

-- Booking hot paths: slot engine (professional + date), client history, and
-- the daily crons that filter by date + status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_professionalId_date_idx" ON "Booking" ("professionalId", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_clientId_idx" ON "Booking" ("clientId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Booking_date_status_idx" ON "Booking" ("date", "status");

-- Payment FK lookups (analytics / billing per business & professional).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_businessId_idx" ON "Payment" ("businessId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_professionalId_idx" ON "Payment" ("professionalId");

-- Review FK lookup (public business profile reviews).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Review_businessId_idx" ON "Review" ("businessId");

-- Promotion FK lookup (active promotions per business).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Promotion_businessId_idx" ON "Promotion" ("businessId");

-- ScheduleException lookup (availability blocks per professional + date).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ScheduleException_professionalId_date_idx" ON "ScheduleException" ("professionalId", "date");
