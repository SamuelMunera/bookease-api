-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "price" DECIMAL(10,2),
ADD COLUMN     "originalPrice" DECIMAL(10,2),
ADD COLUMN     "promoId" TEXT,
ADD COLUMN     "promoTitle" TEXT;
