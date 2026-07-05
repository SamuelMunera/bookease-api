-- Manual column migration (S-005): JWT revocation on password change.
--
-- WHY MANUAL: the Prisma migration ledger is applied manually in this project
-- (see prisma/manual/migrate-deploy.js and the P3009 history). This column MUST
-- be applied by hand against production; the passwordChangedAt field added to
-- model User in schema.prisma describes the desired state but does NOT create
-- the column on its own here.
--
-- HOW TO APPLY (production, one-off): run this file against DIRECT_URL.
--   psql "$DIRECT_URL" -f prisma/manual/20260705000000_add_password_changed_at.sql
--
-- The middleware `authenticate` rejects (401) any JWT whose `iat` predates
-- passwordChangedAt, so changePassword invalidates all previously issued tokens.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
