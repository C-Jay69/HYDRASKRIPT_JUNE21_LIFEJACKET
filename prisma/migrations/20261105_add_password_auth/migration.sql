-- HydraSkript - local password auth (replaces Supabase Auth).
--
-- NextAuth's Credentials provider verifies a bcrypt hash stored on the profile,
-- and password resets use single-use, hashed tokens instead of Supabase's
-- hosted email flow.
--
-- Existing Supabase accounts keep working: Supabase's auth.users
-- "encrypted_password" values are bcrypt, so they can be copied straight into
-- profiles."passwordHash" without forcing a reset.

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_tokenHash_key"
  ON "password_reset_tokens"("tokenHash");

CREATE INDEX IF NOT EXISTS "password_reset_tokens_profileId_idx"
  ON "password_reset_tokens"("profileId");

DO $$ BEGIN
  ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
