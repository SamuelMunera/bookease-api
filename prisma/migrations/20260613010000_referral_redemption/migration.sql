-- CreateEnum
CREATE TYPE "ReferralRedeemerType" AS ENUM ('BUSINESS', 'PROFESSIONAL');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "promoterId" TEXT;

-- AlterTable
ALTER TABLE "Professional" ADD COLUMN "promoterId" TEXT;

-- AlterTable
ALTER TABLE "CourtesyCode"
  ADD COLUMN "redeemedByType" "ReferralRedeemerType",
  ADD COLUMN "redeemedBusinessId" TEXT,
  ADD COLUMN "redeemedProfessionalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CourtesyCode_redeemedBusinessId_key" ON "CourtesyCode"("redeemedBusinessId");

-- CreateIndex
CREATE UNIQUE INDEX "CourtesyCode_redeemedProfessionalId_key" ON "CourtesyCode"("redeemedProfessionalId");

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Professional" ADD CONSTRAINT "Professional_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtesyCode" ADD CONSTRAINT "CourtesyCode_redeemedBusinessId_fkey" FOREIGN KEY ("redeemedBusinessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtesyCode" ADD CONSTRAINT "CourtesyCode_redeemedProfessionalId_fkey" FOREIGN KEY ("redeemedProfessionalId") REFERENCES "Professional"("id") ON DELETE SET NULL ON UPDATE CASCADE;
