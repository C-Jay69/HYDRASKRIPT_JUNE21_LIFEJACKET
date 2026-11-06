import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pgPool: Pool | undefined
}

function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.FUNCTION_TARGET
  )
}

/**
 * Local Postgres runs without TLS (the default pdg/Ubuntu cluster has
 * `ssl = off`). Every hosted provider used in production — Neon, Supabase,
 * Railway, RDS — requires TLS, and `pg` treats `sslmode=require` as
 * verify-full, which fails against a provider CA that Node doesn't ship.
 * Setting `rejectUnauthorized: false` for non-local hosts restores the libpq
 * meaning of "encrypt, do not verify".
 *
 * A hosted connection string that already carries `sslmode` still wins: pg
 * parses sslmode out of the URL and it takes precedence over this option.
 */
function isLocalDatabase(raw: string | undefined): boolean {
  if (!raw) return true
  try {
    const host = new URL(raw).hostname
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === ''
    )
  } catch {
    // Unix-socket DSNs (postgresql:///db) have no host → local.
    return true
  }
}

export function resolveConnectionString(raw?: string): string | undefined {
  // Kept as an extension point (and to preserve the exported API). Connection
  // strings are used verbatim now that the Supabase pooler rewrite is gone.
  return raw
}

function createPool(): Pool {
  const serverless = isServerlessRuntime()
  const connectionString = resolveConnectionString(process.env.DATABASE_URL)

  // One or two connections per serverless instance. A pool of 10 * dozens of
  // warm lambdas exhausts a small hosted database and surfaces as Prisma P2028
  // ("Unable to start a transaction in the given time").
  const max = parseInt(
    process.env.DATABASE_POOL_MAX || (serverless ? '5' : '10'),
    10
  )
  // How long a query waits for a pooled connection before Prisma throws
  // P2028. The queue's status writes MUST survive short bursts of contention
  // (a poll storm, a big `jobs.result` update), so waiting beats failing: a
  // failed `completed` write is exactly what strands a finished book at
  // "Queued...". Keep it below the platform's function timeout.
  //
  // Long-running jobs (an audiobook narrates each segment through TTS, which
  // can take 30-60s per chunk) leave the pool idle between DB writes. The idle
  // timeout below must therefore exceed the longest provider call, or the only
  // warm connection is torn down mid-job and every later write pays a cold
  // reconnect — which is how "Connection terminated due to connection timeout"
  // shows up on an otherwise healthy database.
  const connectionTimeoutMs = parseInt(
    process.env.PRISMA_CONNECTION_TIMEOUT || (serverless ? '30000' : '10000'),
    10
  )
  return new Pool({
    application_name: 'hydraskript-web',
    connectionString,
    ssl: isLocalDatabase(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
    min: 0,
    max: Number.isFinite(max) && max > 0 ? max : serverless ? 5 : 10,
    idleTimeoutMillis: serverless ? 60_000 : 30_000,
    connectionTimeoutMillis: connectionTimeoutMs,
    // Reap dead TCP sockets quickly: a hosted connection that died during an
    // instance freeze otherwise sits "checked out" and stalls the next query
    // behind it until the connect timeout expires.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    allowExitOnIdle: serverless,
  })
}

const pool = globalForPrisma.pgPool ?? createPool()
globalForPrisma.pgPool = pool

const adapter = new PrismaPg(pool)

const logConfig =
  process.env.PRISMA_QUERY_LOG === '1'
    ? ['query', 'warn', 'error']
    : ['warn', 'error']

// These options apply only to interactive `$transaction(async tx => ...)`
// calls. LLM work must NEVER run inside a Prisma transaction — a 120s
// timeout was holding pool connections and causing P2028 on heartbeats.
//
// `maxWait` is how long Prisma will wait for a connection before throwing
// P2028 ("Unable to start a transaction in the given time"). It must be >=
// the pg pool's connectionTimeoutMillis, otherwise Prisma gives up first and
// the queue's status writes fail even though a connection was 2s away.
const transactionOptions = {
  maxWait: parseInt(process.env.PRISMA_TRANSACTION_MAX_WAIT || '25000', 10),
  timeout: parseInt(process.env.PRISMA_TRANSACTION_TIMEOUT || '30000', 10),
  isolationLevel: 'ReadCommitted' as const,
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: logConfig as ('query' | 'warn' | 'error')[],
    transactionOptions,
  })

// Always cache on globalThis. Next.js (dev AND serverless) can evaluate this
// module more than once per process; without the cache each evaluation opens
// another pg Pool and we hit "max clients reached" / P2028.
globalForPrisma.prisma = db

export { transactionOptions }

if (process.env.NODE_ENV !== 'production') {
  const shutdown = async () => {
    await pool.end()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
