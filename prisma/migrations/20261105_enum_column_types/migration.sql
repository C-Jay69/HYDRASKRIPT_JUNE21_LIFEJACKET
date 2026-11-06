-- HydraSkript - convert the `jobs` TEXT columns to the enum types.
--
-- schema.prisma declares Job.jobType as JobType and Job.status as JobStatus,
-- but the init migration created both columns as TEXT. `scripts/fix-enums.ts`
-- converted them by hand on the old database; doing it here means a fresh
-- database (local or Neon) reaches the same state.
--
-- Only `jobs` is converted: books."status", chapters."status" and
-- editorial_reviews."status" are plain String columns in schema.prisma and
-- must stay TEXT.
--
-- Runs in its own transaction after 20260914 so every enum label is already
-- committed (PostgreSQL refuses to cast to a label added in the same
-- transaction). Both blocks are guarded on the column still being TEXT, so
-- this is a no-op on a database that is already converted.

DO $$
BEGIN
  IF (
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'jobType'
  ) = 'text' THEN
    ALTER TABLE "jobs" ALTER COLUMN "jobType" TYPE "JobType" USING "jobType"::"JobType";
  END IF;

  IF (
    SELECT udt_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = 'status'
  ) = 'text' THEN
    ALTER TABLE "jobs" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "jobs" ALTER COLUMN "status" TYPE "JobStatus" USING "status"::"JobStatus";
    ALTER TABLE "jobs" ALTER COLUMN "status" SET DEFAULT 'queued';
  END IF;
END $$;
