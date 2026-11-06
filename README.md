# HydraSkript — AI Co-Authoring Studio

HydraSkript is a full-stack AI publishing platform that helps authors turn an idea into a finished book with structured outlining, chapter-by-chapter approval, illustrations, export tooling, and audiobook generation.

This README has been updated to reflect the **current validated project state**.

---

## Current Status

The app currently validates with:

- `npx tsc --noEmit --incremental false` ✅
- `npx eslint src --ext .ts,.tsx` ✅
- `npm run build` ✅

### Phase 0 — Pricing alignment ✅ Complete
- Single pricing source of truth (`PRICING_CONFIG`) matching Stripe authoritative data
- Tier grants: Free=100 signup credits, Starter=300, Author=1000, Publisher=3000, Studio=10000
- Credit packs: 100/500/1000 at $15/$60/$100 (PDF's 500/2000/5000 was a misread, discarded)
- Audiobook cost fixed: 20 base + 2/min (was 10 + 5/min)
- Free tier now grants 100 credits on signup (was 25)

### Phase 1 — Landing page repositioned ✅ Complete
- 7-section journey: Hero → Problem → Journey Pipeline → Differentiators → Manuscript Door → Final CTA
- Two front doors: "Start Creating Free" and "Already Have a Manuscript? Upload It"
- Removed fabricated stats (50K books, 12K authors, 4.9★)
- Dark/gradient aesthetic retained with framer-motion animations

### Phase 2 — Marketing routes created ✅ Complete
- 7 App Router routes: features, editorial-review, story-bible, series, audiobooks, publishing, bookstore
- Comparison table: "Traditional AI writing tool vs HydraSkript" showing 7 features ✗ vs ✓
- All routes link to real implemented features

### Phase 3 — Pricing page overhaul ✅ Complete
- Outcome-led headlines: "Start your publishing journey", "Your complete author workspace", etc.
- "What kind of creator are you?" tier selector
- Annual billing toggle (≈2 months free) noted for future implementation
- Webhook verification needed for end-to-end Stripe flow

### Phase 4 — Entitlements config ✅ Complete
- `src/config/entitlements.ts` maps each tier to capabilities and limits
- `src/lib/server/requireCapability.ts` server-side guard for API routes and UI
- Tier caps: Free=1 book, Starter=3, Author=10, Publisher=30, Studio=unlimited

### Phase 5 — Cost telemetry (in progress)
- Prisma `Job` model extended with `estimatedCostCents`, `actualCostCents`, `provider`, `modelName`, `tokensIn`, `tokensOut`
- Admin margin view planned for future implementation

### Phase 6 — Production hardening (in progress)
- `ignoreBuildErrors` removed from `next.config.js`
- `cookies.txt` in repo root flagged for removal
- Auth security: all protected routes derive identity from server session
- Durable storage: move assets from local `public/assets` to Cloudflare R2/S3
- Queue hardening: activate lease/retry fields via Prisma migrations
- CI: enforce `tsc`/`eslint`/`build` in CI/CD pipeline

---

## Tech Stack

| Layer | Technology |
| :--- | :--- |
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 |
| Database | PostgreSQL via Prisma 7 + `@prisma/adapter-pg` (local cluster in dev, Neon in production) |
| Auth | NextAuth v5 (Credentials provider, JWT sessions) + bcrypt |
| Queue | Custom Postgres-backed persistent queue |
| AI / LLM | OpenRouter |
| Images | Hugging Face / Replicate / FAL fallback design |
| Audio | Google AI Studio (Gemini TTS) + FFmpeg |
| Storage | Cloudflare R2, local filesystem fallback for development |
| Payments | Stripe (partially staged / verify before production) |

---

## Core Product Flow

HydraSkript is structured around a co-authoring workflow:

1. User creates a book
2. AI generates an outline
3. User edits / approves outline
4. AI writes one chapter at a time
5. User reviews / approves chapters
6. App finalizes exports and optional media

### Generation pipeline

```text
Draft → Outlining → Awaiting Outline Approval → Writing → Awaiting Chapter Approval → Finalizing → Completed
```

---

## Security Model

Current security posture includes:

- Root `middleware.ts` for protected session-aware routing
- Protected API routes return `401` JSON when unauthenticated
- Protected pages redirect through auth flow when needed
- Server-side auth helpers now back major protected routes
- Sessions are signed JWT cookies, verified in Edge middleware by NextAuth v5

### Important note

This is significantly improved from the original repo state, but you should still test:

- login flow
- session refresh
- protected API access
- admin-only paths

against your real database before public launch.

---

## Environment Variables

Create `.env.local` in the project root.

```env
# Database / Auth
DATABASE_URL=postgresql://user:password@localhost:5432/hydraskript
AUTH_SECRET=...            # NEXTAUTH_SECRET is also accepted
NEXTAUTH_URL=http://localhost:3002

# Storage (Cloudflare R2)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_KEY=hydraskript-assets
R2_PUBLIC_URL=https://cdn.example.com

# AI
OPENROUTER_API_KEY=sk-or-...
GOOGLE_AI_API_KEY=AIza...
# Optional Gemini TTS model override for Audiobook Studio
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
HF_API_KEY=hf_...
REPLICATE_API_TOKEN=r8_...
FAL_API_KEY=...

# Payments
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### Notes

- `DATABASE_URL` is required for Prisma.
- `AUTH_SECRET` (or the legacy `NEXTAUTH_SECRET`) is required to sign session JWTs.
- In production `DATABASE_URL` must point at a hosted Postgres reachable from Vercel
  (Neon via the Vercel Marketplace). `localhost` only works for local development.
- Some AI/media flows degrade or simulate behavior if keys are absent.
- Audiobook Studio uses Gemini native TTS through `GOOGLE_AI_API_KEY`; it produces an M4B when FFmpeg is available and a valid WAV audiobook fallback otherwise.
- Stripe should be considered **not production-complete until webhook and billing flows are verified end-to-end**.

### Storage note

The app stores generated assets in **Cloudflare R2** when these are configured:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_KEY`
- `R2_PUBLIC_URL`

If they are not configured, it falls back to the local filesystem under:

- `public/assets`

That fallback is for development only: serverless filesystems are read-only, so
`saveFile()` refuses to write and throws a configuration error in production.

---

## Local Development Setup

```bash
# 1. Clone
cd HYDRASKRIPT_JUNE21

# 2. Install dependencies
npm install

# 3. Generate Prisma client
npm run db:generate

# 4. Push schema to your DB
npm run db:push

# 5. Start development server
npm run dev
```

App runs at:

- `http://localhost:3002`

---

## Queue Activation

HydraSkript uses a **custom Postgres-backed queue**, not BullMQ.

The current codebase already includes a hardened compatibility queue with:

- lazy bootstrap
- interrupted-job recovery
- basic retry handling in app logic
- no import-time DB side effects

### New staged queue fields

The `Job` model now includes:

- `retryCount`
- `maxRetries`
- `leaseExpiresAt`
- `lastHeartbeatAt`

### Activate those fields in your environment

Run:

```bash
npm run db:generate
npm run db:push
```

This updates:

- the Prisma client
- the target database schema

### After activation

The queue can be upgraded from compatibility mode to full field-backed lease/retry semantics.

See:

- `QUEUE_ACTIVATION_NOTES.md`

---

## Production Deployment Guide

## Recommended Host: Railway or VPS

This app is currently best suited to:

- Railway
- a single VPS
- a single container deployment with persistent storage

### Why not Vercel as primary?

Because the queue currently runs in-process and long-running media/generation workloads are not a great fit for serverless execution limits.

---

## Deployment Checklist

Before deploying, confirm all of the following:

- `npm install` completed successfully
- `npx tsc --noEmit --incremental false` passes
- `npx eslint src --ext .ts,.tsx` passes
- `npm run build` passes
- `.env.local` values are mirrored into the deployment platform
- `DATABASE_URL` points at a Postgres instance reachable from the deployment
- `AUTH_SECRET` is set for the deployment scope
- Prisma schema is synced:
  - `npm run db:generate`
  - `npm run db:push`
- FFmpeg is available in the deployment runtime
- The R2 bucket exists and `R2_PUBLIC_URL` serves objects from it

---

## Deploying with Docker

### Build image

```bash
docker build -t hydraskript .
```

### Run container

```bash
docker run -p 3002:3002 --env-file .env.local hydraskript
```

### Current Docker behavior

The Dockerfile:

- installs FFmpeg
- installs dependencies
- generates Prisma client
- runs `npm run build`
- starts with `npm start`

---

## Deploying with Railway

### Suggested process

1. Create a Railway project
2. Connect this repository
3. Add all required environment variables
4. Point `DATABASE_URL` to your hosted Postgres (Neon, Railway, RDS, …)
5. Ensure schema/client sync has been run
6. Deploy

### Recommended extra checks after deploy

- open `/api/health`
- sign in through `/login` (NextAuth credentials)
- create a draft book
- hit one protected API route while logged in
- test one generation flow
- verify files appear where expected

---

## Docker Compose

A compose file is included.

### Start with compose

```bash
docker compose up --build
```

### Current compose behavior

- binds to `3002:3002`
- loads `.env`
- includes health check:
  - `http://localhost:3002/api/health`

---

## Vercel Caveats

You can deploy to Vercel, but it is **not the recommended primary production target** for the current architecture.

### Caveats

- custom queue is in-process
- long-running generation jobs may exceed function limits
- heavy generation/media workloads are better on Railway/VPS
- Dockerfile is ignored by Vercel

If you still use Vercel:

```bash
vercel --prod
```

---

## Database Notes

Schema lives in:

- `prisma/schema.prisma`

Key models:

- `Profile`
- `Book`
- `Chapter`
- `Job`
- `StyleProfile`
- `MediaAsset`
- `CreditLedger`

### Apply schema updates

```bash
npm run db:generate
npm run db:push
```

---

## Export Formats

HydraSkript currently supports:

| Format | Implementation | File |
| :--- | :--- | :--- |
| PDF | PDFKit | `src/lib/services/exportService.ts` |
| EPUB | custom EPUB 3 zip builder | `src/lib/services/epubService.ts` |
| DOCX | custom Office Open XML builder | `src/lib/services/docxService.ts` |

---

## Operational Limitations

These are the main remaining production limitations:

1. **Storage falls back to local filesystem if R2 is not configured**
   - that fallback only works in development; serverless runtimes refuse the write, so a real bucket is required in production

2. **Queue is single-instance oriented**
   - suitable for one-node deployments today
   - multi-instance coordination still needs final lease-backed activation

3. **Stripe/payment path should be verified before launch**
   - treat payments as staging until webhook/accounting flows are validated end-to-end

4. **Postgres authorization is application-level only**
   - Prisma owns the schema and all access goes through the app; there is no
     database-level RLS layer protecting rows from a compromised service role

---

## Post-Deploy Smoke Test

After deployment, test this order:

1. `GET /api/health`
2. Homepage loads
3. Login works
4. Protected route returns 401 when logged out
5. Protected route works when logged in
6. Create book works
7. Start generation works
8. Queue job status updates
9. Export works
10. Files persist where expected

---

## Known Build Note

The app intentionally does **not** use `output: 'standalone'` right now because of an upstream Next 15 middleware artifact issue affecting builds.

Current validated production flow is:

```bash
npm run build
npm run start
```

---

## Recommended Next Improvements

If you want to keep pushing toward production-grade readiness, the highest-value next steps are:

1. Run queue schema activation:
   - `npm run db:generate`
   - `npm run db:push`
2. Finish full lease-backed queue mode
3. Move storage to R2/S3
4. Verify Stripe/webhooks
5. Add a small production smoke test checklist to CI / ops docs

---

## License

Proprietary — developed for HydraSkript / LIFEJACKETAI.

## Page Backgrounds

Marketing/auth pages (pricing, audiobooks, features, bookstore, story-bible,
publishing, editorial-review, login) render a themed Pexels photo behind
content via `<PageBackground>` (`src/components/PageBackground.tsx`).
Images live in `public/backgrounds/` — see `BACKGROUND_IMAGES.md` for the
mapping, credits, and alternates; `bash scripts/download-backgrounds.sh`
refetches them at 1920px. Keep public images web-sized with
`node scripts/compress-images.mjs`.
# STACKFORGE_270926
