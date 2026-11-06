#!/usr/bin/env bash
# HydraSkript - one-time local PostgreSQL bootstrap.
#
# Reads DATABASE_URL from .env.local, then creates the role and database it
# names (and grants CREATEDB so `prisma migrate dev` can create a shadow
# database). Safe to re-run: existing objects are left in place and the role's
# password is re-synced to whatever .env.local says.
#
# Requires sudo (runs psql as the `postgres` superuser via peer auth).
# The password is never printed.
#
# Usage:  bash scripts/setup-local-postgres.sh

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found (run from the project root)" >&2
  exit 1
fi

# Parse DATABASE_URL without ever logging it.
mapfile -t DB_PARTS < <(ENV_FILE_PATH="$ENV_FILE" node -e '
  const fs = require("fs");
  const text = fs.readFileSync(process.env.ENV_FILE_PATH, "utf8");
  let raw = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
    if (m) raw = m[1].trim();
  }
  raw = raw.replace(/^["\x27]|["\x27]$/g, "");
  if (!raw) { console.error("error: DATABASE_URL missing from .env.local"); process.exit(2); }
  const url = new URL(raw);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  const name = url.pathname.replace(/^\//, "");
  if (!user || !name) { console.error("error: DATABASE_URL has no user or database"); process.exit(2); }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    console.error(`error: DATABASE_URL host is ${url.hostname}, not localhost`);
    process.exit(3);
  }
  console.log(user);
  console.log(pass);
  console.log(name);
')

DB_USER="${DB_PARTS[0]:-}"
DB_PASS="${DB_PARTS[1]:-}"
DB_NAME="${DB_PARTS[2]:-}"
if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  echo "error: could not parse DATABASE_URL from $ENV_FILE" >&2
  exit 1
fi

echo "Bootstrapping local Postgres for role '${DB_USER}' and database '${DB_NAME}'..."

# `-v pw=...` keeps the password out of the process argument list beyond psql's
# own variable expansion, and %L below makes it a properly escaped literal.
sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$DB_PASS" \
  -v dbuser="$DB_USER" -v dbname="$DB_NAME" <<'SQL'
\set QUIET on
-- Create the role if it does not exist yet.
SELECT format('CREATE ROLE %I LOGIN CREATEDB PASSWORD %L', :'dbuser', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'dbuser')
\gexec

-- Always re-sync the password with .env.local, and make sure CREATEDB is on
-- (Prisma needs it for the shadow database used by `migrate dev`).
SELECT format('ALTER ROLE %I LOGIN CREATEDB PASSWORD %L', :'dbuser', :'pw')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'dbuser')
\gexec

-- Create the database if it is missing.
SELECT format('CREATE DATABASE %I OWNER %I', :'dbname', :'dbuser')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname')
\gexec

-- If it already existed with a different owner, hand it over.
SELECT format('ALTER DATABASE %I OWNER TO %I', :'dbname', :'dbuser')
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname');
\gexec
\set QUIET off
SQL

echo "Postgres role and database are ready."
echo "Next: npx prisma migrate deploy && npx prisma generate"
