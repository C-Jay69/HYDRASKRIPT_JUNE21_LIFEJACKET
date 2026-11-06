-- HydraSkript - bring the migration history up to schema.prisma.
--
-- The init migration predates the founder-sale, subscription, cost-telemetry
-- and bookstore features, and those tables/columns were added to the datamodel
-- without a corresponding migration. A database built from the migration
-- history alone was therefore missing them, which `prisma migrate diff`
-- reported as drift. This closes the gap.
--
-- Generated from `prisma migrate diff --from-config-datasource
-- --to-schema prisma/schema.prisma`, with one change: the new NOT NULL
-- "updatedAt" columns are added with a temporary DEFAULT so the migration also
-- succeeds on a database that already contains rows.
--
-- Nothing here drops columns or types.

-- AlterTable: books
ALTER TABLE "books"
  ADD COLUMN IF NOT EXISTS "chapterCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "description" TEXT;

-- AlterTable: editorial_reviews
ALTER TABLE "editorial_reviews" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "editorial_reviews" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable: jobs (cost telemetry)
ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "estimatedCostCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualCostCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "provider" TEXT,
  ADD COLUMN IF NOT EXISTS "modelName" TEXT,
  ADD COLUMN IF NOT EXISTS "tokensIn" INTEGER,
  ADD COLUMN IF NOT EXISTS "tokensOut" INTEGER;

-- AlterTable: media_assets
ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "paymentSource" TEXT DEFAULT 'subscription_allowance';

-- AlterTable: profiles (billing / credits / founder programme)
ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "audiobookEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "founderBadge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "founderNumber" INTEGER,
  ADD COLUMN IF NOT EXISTS "freeCreditsGranted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isLifetime" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "lifetimeCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "monthlyCreditAllowance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "monthlyCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "monthlyCreditsLastGrantedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purchasedCredits" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT,
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT NOT NULL DEFAULT 'inactive';

ALTER TABLE "profiles" ALTER COLUMN "credits" SET DEFAULT 0;
ALTER TABLE "profiles" ALTER COLUMN "tier" SET DEFAULT 'free';

-- CreateTable: founder_sales
CREATE TABLE IF NOT EXISTS "founder_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "founderNumber" INTEGER NOT NULL,
    "pricePaidCents" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "founder_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable: book_listings (bookstore)
CREATE TABLE IF NOT EXISTS "book_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "format" TEXT NOT NULL DEFAULT 'ebook',
    "fileName" TEXT,
    "fileUrl" TEXT,
    "coverUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_listings_pkey" PRIMARY KEY ("id")
);

-- Prisma's @updatedAt manages this field; the temporary default was only there
-- so the NOT NULL column could be added safely.
ALTER TABLE "book_listings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "founder_sales_profileId_key" ON "founder_sales"("profileId");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_sales_founderNumber_key" ON "founder_sales"("founderNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_sales_stripeCheckoutSessionId_key" ON "founder_sales"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX IF NOT EXISTS "founder_sales_stripePaymentIntentId_key" ON "founder_sales"("stripePaymentIntentId");

CREATE INDEX IF NOT EXISTS "book_listings_ownerId_idx" ON "book_listings"("ownerId");
CREATE INDEX IF NOT EXISTS "book_listings_status_idx" ON "book_listings"("status");

CREATE INDEX IF NOT EXISTS "books_ownerId_idx" ON "books"("ownerId");
CREATE INDEX IF NOT EXISTS "credit_ledger_profileId_idx" ON "credit_ledger"("profileId");
CREATE INDEX IF NOT EXISTS "credit_ledger_jobId_idx" ON "credit_ledger"("jobId");

CREATE INDEX IF NOT EXISTS "jobs_status_leaseExpiresAt_idx" ON "jobs"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "jobs_ownerId_idx" ON "jobs"("ownerId");
CREATE INDEX IF NOT EXISTS "jobs_bookId_idx" ON "jobs"("bookId");

CREATE INDEX IF NOT EXISTS "media_assets_bookId_idx" ON "media_assets"("bookId");
CREATE INDEX IF NOT EXISTS "media_assets_ownerId_idx" ON "media_assets"("ownerId");
CREATE INDEX IF NOT EXISTS "media_assets_assetType_idx" ON "media_assets"("assetType");

CREATE UNIQUE INDEX IF NOT EXISTS "profiles_founderNumber_key" ON "profiles"("founderNumber");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "founder_sales"
    ADD CONSTRAINT "founder_sales_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "book_listings"
    ADD CONSTRAINT "book_listings_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
