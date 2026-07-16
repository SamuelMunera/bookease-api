-- Fidelización tipo punch-card (plan Estudio). Todo idempotente: se puede
-- ejecutar en cada deploy sin efecto si ya está aplicado. Sin enums de Postgres
-- a propósito (TEXT + DEFAULT, mismo patrón que CancellationFee) para no pelear
-- con el ledger P3009 bloqueado.

CREATE TABLE IF NOT EXISTS "LoyaltyProgram" (
  "id"                TEXT NOT NULL,
  "businessId"        TEXT NOT NULL,
  "isActive"          BOOLEAN NOT NULL DEFAULT false,
  "stampsRequired"    INTEGER NOT NULL DEFAULT 8,
  "rewardType"        TEXT NOT NULL DEFAULT 'FREE_SERVICE',
  "rewardServiceId"   TEXT,
  "rewardDiscount"    INTEGER,
  "rewardDescription" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyProgram_businessId_key" ON "LoyaltyProgram"("businessId");

CREATE TABLE IF NOT EXISTS "LoyaltyCard" (
  "id"              TEXT NOT NULL,
  "programId"       TEXT NOT NULL,
  "businessId"      TEXT NOT NULL,
  "clientId"        TEXT NOT NULL,
  "stamps"          INTEGER NOT NULL DEFAULT 0,
  "totalStamps"     INTEGER NOT NULL DEFAULT 0,
  "cyclesCompleted" INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyCard_businessId_clientId_key" ON "LoyaltyCard"("businessId", "clientId");
CREATE INDEX IF NOT EXISTS "LoyaltyCard_programId_idx" ON "LoyaltyCard"("programId");
CREATE INDEX IF NOT EXISTS "LoyaltyCard_clientId_idx" ON "LoyaltyCard"("clientId");

CREATE TABLE IF NOT EXISTS "LoyaltyStamp" (
  "id"        TEXT NOT NULL,
  "cardId"    TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "cycle"     INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyStamp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LoyaltyStamp_bookingId_key" ON "LoyaltyStamp"("bookingId");
CREATE INDEX IF NOT EXISTS "LoyaltyStamp_cardId_idx" ON "LoyaltyStamp"("cardId");

CREATE TABLE IF NOT EXISTS "LoyaltyReward" (
  "id"                TEXT NOT NULL,
  "cardId"            TEXT NOT NULL,
  "businessId"        TEXT NOT NULL,
  "clientId"          TEXT NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'EARNED',
  "rewardType"        TEXT NOT NULL,
  "rewardServiceId"   TEXT,
  "rewardServiceName" TEXT,
  "rewardDiscount"    INTEGER,
  "rewardDescription" TEXT,
  "earnedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "redeemedAt"        TIMESTAMP(3),
  "redeemedById"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyReward_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LoyaltyReward_businessId_status_idx" ON "LoyaltyReward"("businessId", "status");
CREATE INDEX IF NOT EXISTS "LoyaltyReward_clientId_status_idx" ON "LoyaltyReward"("clientId", "status");

-- FKs: ADD CONSTRAINT no soporta IF NOT EXISTS, se hace idempotente vía catálogo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyProgram_businessId_fkey') THEN
    ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_businessId_fkey"
      FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyProgram_rewardServiceId_fkey') THEN
    ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_rewardServiceId_fkey"
      FOREIGN KEY ("rewardServiceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyCard_programId_fkey') THEN
    ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_programId_fkey"
      FOREIGN KEY ("programId") REFERENCES "LoyaltyProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyCard_clientId_fkey') THEN
    ALTER TABLE "LoyaltyCard" ADD CONSTRAINT "LoyaltyCard_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyStamp_cardId_fkey') THEN
    ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_cardId_fkey"
      FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyStamp_bookingId_fkey') THEN
    ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyReward_cardId_fkey') THEN
    ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_cardId_fkey"
      FOREIGN KEY ("cardId") REFERENCES "LoyaltyCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoyaltyReward_clientId_fkey') THEN
    ALTER TABLE "LoyaltyReward" ADD CONSTRAINT "LoyaltyReward_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
