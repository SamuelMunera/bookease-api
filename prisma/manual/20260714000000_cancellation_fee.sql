-- Multa por cancelación tardía / no-show (config del profesional + tabla de
-- deudas). Todo idempotente: se puede ejecutar en cada deploy sin efecto si ya
-- está aplicado. Sin enum de Postgres a propósito (TEXT + DEFAULT, mismo patrón
-- que BusinessReferral.status) para no pelear con el ledger bloqueado.

ALTER TABLE "Professional" ADD COLUMN IF NOT EXISTS "cancelFeeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Professional" ADD COLUMN IF NOT EXISTS "cancelFeeWindowHours" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Professional" ADD COLUMN IF NOT EXISTS "cancelFeeAmount" DECIMAL(10,2);

CREATE TABLE IF NOT EXISTS "CancellationFee" (
  "id"             TEXT NOT NULL,
  "bookingId"      TEXT NOT NULL,
  "professionalId" TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "amount"         DECIMAL(10,2) NOT NULL,
  "reason"         TEXT NOT NULL DEFAULT 'LATE_CANCEL',
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CancellationFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CancellationFee_bookingId_key" ON "CancellationFee"("bookingId");
CREATE INDEX IF NOT EXISTS "CancellationFee_professionalId_status_idx" ON "CancellationFee"("professionalId", "status");
CREATE INDEX IF NOT EXISTS "CancellationFee_clientId_status_idx" ON "CancellationFee"("clientId", "status");

-- FKs: ADD CONSTRAINT no soporta IF NOT EXISTS, se hace idempotente vía catálogo.
-- onDelete RESTRICT: las deudas deben sobrevivir en reporting, nunca en cascada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CancellationFee_bookingId_fkey') THEN
    ALTER TABLE "CancellationFee" ADD CONSTRAINT "CancellationFee_bookingId_fkey"
      FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CancellationFee_professionalId_fkey') THEN
    ALTER TABLE "CancellationFee" ADD CONSTRAINT "CancellationFee_professionalId_fkey"
      FOREIGN KEY ("professionalId") REFERENCES "Professional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CancellationFee_clientId_fkey') THEN
    ALTER TABLE "CancellationFee" ADD CONSTRAINT "CancellationFee_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
