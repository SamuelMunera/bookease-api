-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "themeLight" JSONB,
ADD COLUMN     "themeDark" JSONB,
ADD COLUMN     "apptVerifyEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "apptVerifyHoursBefore" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "verificationSentAt" TIMESTAMP(3);
