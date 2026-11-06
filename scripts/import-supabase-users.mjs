// Import Supabase account passwords into HydraSkript profiles.
//
// Run this BEFORE deleting the Supabase project. Afterwards the hashes are
// gone and every user has to reset their password.
//
// 1. In the Supabase SQL editor, run:
//
//      select email, encrypted_password
//      from auth.users
//      where encrypted_password is not null and encrypted_password <> '';
//
//    Export the result as JSON (or CSV). It looks like:
//
//      [{"email":"a@example.com","encrypted_password":"$2a$10$..."}, ...]
//
// 2. From the repo root:
//
//      node scripts/import-supabase-users.mjs ~/Downloads/supabase-users.json
//
//    Add --dry-run first if you want to see what would change.
//
// Supabase stores bcrypt hashes, which is exactly what src/lib/password.ts
// verifies, so the values are copied verbatim — nobody needs to reset.
//
// Requires in .env.local:
//   DATABASE_URL

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const BCRYPT_PREFIXES = ["$2a$", "$2b$", "$2y$"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const file = args.find((a) => !a.startsWith("--"));

if (!file) {
  console.error("usage: node scripts/import-supabase-users.mjs <export.json|export.csv> [--dry-run]");
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`error: ${file} not found`);
  process.exit(1);
}

/** Accepts a JSON array of objects, or a two-column CSV. */
function readRows(contents, filename) {
  const trimmed = contents.trim();

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    return parsed;
  }

  // CSV with a header row: email,encrypted_password
  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const emailIdx = header.indexOf("email");
  const hashIdx = header.findIndex((h) => h === "encrypted_password" || h === "password_hash");
  if (emailIdx === -1 || hashIdx === -1) {
    throw new Error(`${filename}: CSV needs "email" and "encrypted_password" columns`);
  }
  return lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? [];
    const clean = (i) => (cells[i] ?? "").replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim();
    return { email: clean(emailIdx), encrypted_password: clean(hashIdx) };
  });
}

function hashOf(row) {
  const value = row.encrypted_password ?? row.password_hash ?? row.passwordHash ?? "";
  return typeof value === "string" ? value.trim() : "";
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, min: 1, max: 5 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (expected in .env.local)");
  }

  const rows = readRows(fs.readFileSync(file, "utf8"), path.basename(file));
  let updated = 0;
  let created = 0;
  let skippedInvalid = 0;
  let skippedNoEmail = 0;

  for (const row of rows) {
    const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
    const hash = hashOf(row);

    if (!email) {
      skippedNoEmail++;
      continue;
    }
    if (!BCRYPT_PREFIXES.some((p) => hash.startsWith(p))) {
      // Not a bcrypt hash — copying it would create an account nobody can log
      // into, so leave that account to the "forgot password" flow instead.
      skippedInvalid++;
      continue;
    }

    if (dryRun) {
      const existing = await prisma.profile.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true },
      });
      existing ? updated++ : created++;
      continue;
    }

    const existing = await prisma.profile.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });

    if (existing) {
      await prisma.profile.update({ where: { id: existing.id }, data: { passwordHash: hash } });
      updated++;
    } else {
      const name = typeof row.name === "string" ? row.name.trim() : undefined;
      await prisma.profile.create({
        data: { email, passwordHash: hash, ...(name ? { name } : {}) },
      });
      created++;
    }
  }

  const verb = dryRun ? "would be" : "were";
  console.log(`${rows.length} row(s) read from ${path.basename(file)}`);
  console.log(`  ${created} profile(s) ${verb} created`);
  console.log(`  ${updated} existing profile(s) ${verb} updated with a password`);
  if (skippedInvalid) console.log(`  ${skippedInvalid} skipped: not a bcrypt hash (user must reset)`);
  if (skippedNoEmail) console.log(`  ${skippedNoEmail} skipped: missing email`);
  if (dryRun) console.log("\nDry run — nothing was written. Re-run without --dry-run to apply.");
}

main()
  .catch((error) => {
    console.error("import failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
