-- Activate all INACTIVE businesses (previously required Stripe payment)
UPDATE "Business" SET "status" = 'ACTIVE' WHERE "status" = 'INACTIVE';

-- Change column default from INACTIVE to ACTIVE
ALTER TABLE "Business" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
