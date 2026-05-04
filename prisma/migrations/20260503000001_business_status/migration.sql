CREATE TYPE "BusinessStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'SUSPENDED');
ALTER TABLE "Business" ADD COLUMN "status" "BusinessStatus" NOT NULL DEFAULT 'INACTIVE';
UPDATE "Business" SET "status" = 'ACTIVE';
