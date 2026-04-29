-- AlterTable: add paymentGateway to Business
ALTER TABLE "Business" ADD COLUMN "paymentGateway" TEXT;

-- Backfill: Colombia gets Wompi; US remains NULL
UPDATE "Business" SET "paymentGateway" = 'WOMPI' WHERE country = 'CO';
