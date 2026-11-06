#!/usr/bin/env node
// Setup script: creates .env from .env.example if missing, then runs prisma db push

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('[setup] Created .env from .env.example (Postgres DATABASE_URL placeholder). Point DATABASE_URL at your Postgres instance before running db push.');
  } else {
    console.log('[setup] No .env or .env.example found. Create .env with your Postgres DATABASE_URL.');
  }
} else {
  console.log('[setup] .env already exists — skipping creation.');
}

console.log('[setup] Running prisma db push...');
try {
  execSync('node_modules/.bin/prisma db push', { cwd: root, stdio: 'inherit' });
  console.log('[setup] Database ready.');
} catch (e) {
  console.error('[setup] prisma db push failed:', e.message);
  process.exit(1);
}
