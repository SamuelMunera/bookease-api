-- Add Stripe customer IDs to Business and Professional
ALTER TABLE "Business" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Professional" ADD COLUMN "stripeCustomerId" TEXT;

-- Rename gatewaySubscriptionId → stripeSubscriptionId on Subscription
ALTER TABLE "Subscription" RENAME COLUMN "gatewaySubscriptionId" TO "stripeSubscriptionId";

-- Backfill paymentGateway to STRIPE for all existing records
UPDATE "Business" SET "paymentGateway" = 'STRIPE';
UPDATE "Subscription" SET "paymentGateway" = 'STRIPE';
