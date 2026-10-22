// HydraSkript - Per-claim LLM work budget
//
// WHY THIS EXISTS:
// Vercel hard-kills a function at `maxDuration` (300s on Pro, 60s on Hobby).
// Our LLM clients used to default to 3 attempts x 300s per model, rotated across
// 4 providers and ~12 models - so one "503 Service Unavailable - Service
// temporarily overloaded" burst could keep retrying for 15+ minutes. The
// platform froze the instance mid-job, the `jobs` row stayed `active` with its
// lease, and the UI sat on "Queued..." forever with nobody left to drive it.
//
// The fix is to make every claim either finish or bail *cleanly* inside the
// function's real budget. The queue opens a budget window around each worker
// invocation (AsyncLocalStorage, so no call sites need to thread a parameter),
// and every provider clamps its per-attempt timeout and its backoff sleeps to
// what is left in that window. When the window closes we throw
// `LlmBudgetExceededError`, which the queue turns into a *re-queue with backoff*
// instead of a frozen instance and an orphaned lease.

import { AsyncLocalStorage } from 'node:async_hooks'

interface LlmBudgetStore {
  deadlineAt: number
}

const storage = new AsyncLocalStorage<LlmBudgetStore>()

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
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
 * Wall-clock work window for ONE queue claim.
 *
 * On Vercel this must stay under `maxDuration` with room left for the final
 * DB writes (status update + refund), otherwise the instance is frozen mid-job.
 * 300s function -> 240s budget -> 60s of headroom for everything else in the
 * invocation (boot, reconcile, response).
 */
export function defaultClaimBudgetMs(): number {
  return envInt('JOB_BUDGET_MS', isServerlessRuntime() ? 240_000 : 15 * 60_000)
}

/** Minimum budget needed to start another provider/model attempt. */
export const MIN_ATTEMPT_MS = envInt('LLM_MIN_ATTEMPT_MS', 25_000)

/**
 * Default wall-clock cap for ONE provider request. It used to be 300s — the
 * entire Vercel function budget for a single HTTP call, which guaranteed that a
 * slow/overloaded provider ate the whole invocation. Lowered 120s -> 60s
 * (Oct 2026): production logs showed 120s OpenRouter timeouts stacking inside
 * the 300s function cap during free-tier storms. A model that cannot answer
 * within 60s is storming, and rotating to the next provider beats waiting out
 * the hang; inside the 240s claim budget that leaves room for ~3 more tries.
 * Raise via LLM_TIMEOUT_MS if a slow flagship model legitimately needs room.
 */
export function defaultRequestTimeoutMs(): number {
  return envInt('LLM_TIMEOUT_MS', 60_000)
}

/** Runs `fn` inside a fresh LLM work budget. */
export function runWithLlmBudget<T>(budgetMs: number, fn: () => Promise<T>): Promise<T> {
  return storage.run({ deadlineAt: Date.now() + Math.max(5_000, budgetMs) }, fn)
}

/** Milliseconds left in the current claim, or Infinity when unbudgeted (CLI/tests). */
export function remainingLlmBudgetMs(): number {
  const store = storage.getStore()
  if (!store) return Number.POSITIVE_INFINITY
  return store.deadlineAt - Date.now()
}

/** True when there is still enough time to make (and parse) another request. */
export function hasBudgetForAttempt(minMs: number = MIN_ATTEMPT_MS): boolean {
  return remainingLlmBudgetMs() > minMs
}

/**
 * Clamp a fetch timeout so a single attempt can never outlive the claim.
 * Never returns less than 10s: a shorter attempt is more likely to abort a
 * request that would have succeeded than to save the invocation.
 */
export function clampTimeoutMs(wantedMs: number): number {
  const remaining = remainingLlmBudgetMs()
  if (!Number.isFinite(remaining)) return wantedMs
  // Keep ~8s for error handling + the status write that follows.
  return Math.max(10_000, Math.min(wantedMs, remaining - 8_000))
}

/**
 * Sleep, but give up if the claim window would close first.
 * @returns false when the sleep was skipped because the budget ran out.
 */
export async function sleepWithinBudget(ms: number): Promise<boolean> {
  const remaining = remainingLlmBudgetMs()
  if (Number.isFinite(remaining) && remaining <= ms) return false
  await new Promise((resolve) => setTimeout(resolve, ms))
  return true
}

export const LLM_BUDGET_EXCEEDED_CODE = 'LLM_BUDGET_EXCEEDED'

/** Thrown when the per-claim window closes before a provider answered. */
export class LlmBudgetExceededError extends Error {
  readonly code = LLM_BUDGET_EXCEEDED_CODE
  constructor(message: string) {
    super(message)
    this.name = 'LlmBudgetExceededError'
  }
}

export function isLlmBudgetExceeded(error: unknown): boolean {
  if (error instanceof LlmBudgetExceededError) return true
  const msg = error instanceof Error ? error.message : String(error ?? '')
  return msg.includes(LLM_BUDGET_EXCEEDED_CODE)
}

/**
 * Provider conditions that mean "the model is fine, the service is just busy".
 * These deserve a re-queue with backoff rather than a hard failure, because a
 * retry a minute later usually succeeds. 502/503/504 + overload/rate-limit text
 * is exactly what produced the production stall.
 */
export function isProviderTransientError(message: string): boolean {
  return (
    /\b(429|500|502|503|504)\b/.test(message) ||
    /temporarily overloaded|overloaded|rate limit|too many requests|no healthy upstream|upstream connect error|_service_unavailable/i.test(
      message
    )
  )
}

/** Jittered exponential backoff for provider retries (never longer than `maxMs`). */
export function providerBackoffMs(attempt: number, baseMs = 1000, maxMs = 20_000): number {
  const exp = Math.min(baseMs * Math.pow(2, Math.max(0, attempt - 1)), maxMs)
  return Math.round(exp / 2 + Math.random() * exp)
}

/** Keep internal claim exhaustion distinct from actual provider failures. */
export function transientProgressMessage(error: unknown, retry: number, maxRetries: number, jobType?: string): string {
  const reason = isLlmBudgetExceeded(error)
    ? 'Processing time limit reached'
    : jobType === 'generate_audiobook'
      ? 'Gemini TTS temporarily unavailable or rate-limited'
      : 'AI provider temporarily unavailable or rate-limited';
  return `${reason} — re-queued, retry ${retry}/${maxRetries}.`;
}
