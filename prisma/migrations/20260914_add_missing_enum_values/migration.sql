-- HydraSkript - create the enum types and add every value schema.prisma needs.
--
-- History note: the enum types were originally created by running
-- `scripts/fix-enums.ts` by hand against a live database, so this migration
-- (and the init migration, which declares those columns as TEXT) could never
-- build a database from scratch:
--   ERROR: type "JobType" does not exist
-- This file now does both halves of that script idempotently, so a fresh
-- database (local or Neon) ends up in the same state as the patched one.
--
-- Only jobs."jobType" and jobs."status" are stored as enum types in
-- schema.prisma; books/chapters/editorial_reviews keep plain String columns
-- because they are free-form. The unused types are still created here so the
-- physical schema matches the datamodel exactly.
--
-- Values match schema.prisma. Databases patched by fix-enums.ts already hold
-- every label (it created a superset for ChapterStatus), so nothing needs
-- removing — extra labels on a type are harmless.
--
-- Column type conversion (TEXT -> enum) lives in the following migration, so
-- that the ADD VALUE statements below are committed before anything casts to
-- the new labels. PostgreSQL forbids using a label added in the same
-- transaction.

-- Create the types if they do not exist yet.
DO $$ BEGIN
  CREATE TYPE "JobType" AS ENUM (
    'write_chapter', 'generate_image', 'generate_audiobook', 'export_pdf',
    'generate_outline', 'finalize_book', 'editorial_review', 'import_manuscript'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('queued', 'active', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BookStatus" AS ENUM (
    'draft', 'generating', 'completed', 'failed', 'outlining',
    'awaiting_outline_approval', 'writing', 'awaiting_chapter_approval', 'finalizing'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChapterStatus" AS ENUM (
    'pending', 'writing', 'reviewing', 'awaiting_approval', 'completed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EditorReviewStatus" AS ENUM ('queued', 'active', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Patch databases where the type already existed but was missing newer values.
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'import_manuscript';

ALTER TYPE "BookStatus" ADD VALUE IF NOT EXISTS 'outlining';
ALTER TYPE "BookStatus" ADD VALUE IF NOT EXISTS 'awaiting_outline_approval';
ALTER TYPE "BookStatus" ADD VALUE IF NOT EXISTS 'writing';
ALTER TYPE "BookStatus" ADD VALUE IF NOT EXISTS 'awaiting_chapter_approval';
ALTER TYPE "BookStatus" ADD VALUE IF NOT EXISTS 'finalizing';

ALTER TYPE "ChapterStatus" ADD VALUE IF NOT EXISTS 'awaiting_approval';
