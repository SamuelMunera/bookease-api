-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "plan" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "paymentGateway" TEXT,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "gatewaySubscriptionId" TEXT,
    "businessId" TEXT,
    "professionalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");
CREATE UNIQUE INDEX "Subscription_professionalId_key" ON "Subscription"("professionalId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_professionalId_fkey"
    FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing businesses → ACTIVE (ya estaban usando la plataforma)
INSERT INTO "Subscription" (
    id, status, plan, country, "paymentGateway",
    "currentPeriodStart", "currentPeriodEnd", "trialEndsAt",
    "cancelAtPeriodEnd", "businessId", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    'ACTIVE'::"SubscriptionStatus",
    b.plan,
    b.country,
    b."paymentGateway",
    NOW(),
    NOW() + INTERVAL '30 days',
    NULL,
    false,
    b.id,
    NOW(),
    NOW()
FROM "Business" b;

-- Backfill: solo professionals (sin negocio) → ACTIVE
INSERT INTO "Subscription" (
    id, status, plan, country, "paymentGateway",
    "currentPeriodStart", "currentPeriodEnd", "trialEndsAt",
    "cancelAtPeriodEnd", "professionalId", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    'ACTIVE'::"SubscriptionStatus",
    p.plan,
    p.country,
    CASE WHEN p.country = 'CO' THEN 'WOMPI' ELSE NULL END,
    NOW(),
    NOW() + INTERVAL '30 days',
    NULL,
    false,
    p.id,
    NOW(),
    NOW()
FROM "Professional" p
WHERE p."businessId" IS NULL;
