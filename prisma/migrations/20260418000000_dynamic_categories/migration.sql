-- CreateTable
CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category"("slug");

-- Seed
INSERT INTO "Category" ("name", "slug", "icon") VALUES
  ('Barbería', 'BARBERSHOP', '✂️'),
  ('Spa & Wellness', 'SPA', '💆'),
  ('Salón de Belleza', 'SALON', '💅')
ON CONFLICT DO NOTHING;

-- Convert Business.category from enum to text
ALTER TABLE "Business" ADD COLUMN IF NOT EXISTS "_cat_text" TEXT;
UPDATE "Business" SET "_cat_text" = category::TEXT WHERE "_cat_text" IS NULL;
ALTER TABLE "Business" DROP COLUMN IF EXISTS category;
ALTER TABLE "Business" RENAME COLUMN "_cat_text" TO category;
ALTER TABLE "Business" ALTER COLUMN category SET NOT NULL;

-- DropEnum
DROP TYPE IF EXISTS "BusinessCategory";
