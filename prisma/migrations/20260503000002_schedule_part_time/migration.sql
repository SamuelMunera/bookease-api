ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "scheduleType" TEXT NOT NULL DEFAULT 'fulltime';
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "secondStartTime" TEXT;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "secondEndTime" TEXT;

ALTER TABLE "ScheduleOverride" ADD COLUMN IF NOT EXISTS "scheduleType" TEXT NOT NULL DEFAULT 'fulltime';
ALTER TABLE "ScheduleOverride" ADD COLUMN IF NOT EXISTS "secondStartTime" TEXT;
ALTER TABLE "ScheduleOverride" ADD COLUMN IF NOT EXISTS "secondEndTime" TEXT;
