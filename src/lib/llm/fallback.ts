// HydraSkript - LLM fallback
// Primary provider: OpenRouter. Secondary: NVIDIA NIM. Tertiary: Google Gemini. Quaternary: Mistral.
// Used for both structured JSON generation and free-form text (chapter prose).
//
// Instead of trusting a single model id (which 410s when NVIDIA retires a model
// or 429s when an OpenRouter free model is rate-limited), each call rotates
// through a CHAIN of currently-valid models per provider, then across providers.
// An explicitly requested model is tried first, then the configured chain.

import {
  hasBudgetForAttempt,
  LLM_BUDGET_EXCEEDED_CODE,
  isLlmBudgetExceeded,
  isProviderTransientError,
  LlmBudgetExceededError,
} from '@/lib/llm/budget';
import { askLLMJSON, askLLM } from '@/lib/llm/openrouter';
import { askLLMJSON as askLLMGeminiJSON, askLLM as askLLMGemini } from '@/lib/llm/google-gemini';
import { askLLMJSON as askLLMNimJSON, askLLM as askLLMNim } from '@/lib/llm/nvidia-nim';
import { askLLMJSON as askLLMMistralJSON, askLLM as askLLMMistral } from '@/lib/llm/mistral';

// Model lists verified against the NVIDIA NIM, OpenRouter and Gemini catalogs
// (live-tested 12 Sep 2026). Retired/renamed ids such as
// `meta/llama-3.1-8b-instruct` (410 Gone), `nvidia/llama-3.1-nemotron-70b-instruct`
// and `mistralai/mistral-large-2-instruct` (404 on NIM), `minimax/minimax-m3:free`
// (no longer free on OpenRouter) and `gemini-2.5-flash` (404 for new Google AI
// projects) must NOT be used.
//
// IMPORTANT: NVIDIA NIM model IDs MUST include a provider prefix (e.g.
// "nvidia/nemotron-3-super-120b-a12b", "google/gemma-4-31b-it").  A bare model
// name like "mistral-large-2411" is a Mistral AI model — NOT a valid NIM ID —
// and will 404 on the NIM endpoint.  The `isValidNimModel` guard below ensures
// such values are filtered out of the NIM chains even when the env var is
// misconfigured in production.

function isValidNimModel(model: string): boolean {
  // NIM model IDs always contain a "/" provider prefix.
  return model.includes('/');
}

// NVIDIA NIM model chains (prefer the newest, strongest instruction followers).
// Env vars are validated — a bare name like "mistral-large-2411" (which belongs
// to the Mistral provider, not NIM) is silently dropped so the chain still works.
const NIM_JSON_CHAIN = [
  process.env.NVIDIA_NIM_MODEL_JSON,
  'nvidia/nemotron-3-super-120b-a12b',
  'google/gemma-4-31b-it',
].filter((m) => !m || isValidNimModel(m));

const NIM_PROSE_CHAIN = [
  process.env.NVIDIA_NIM_MODEL,
  'nvidia/nemotron-3-super-120b-a12b',
  'google/gemma-4-31b-it',
].filter((m) => !m || isValidNimModel(m));

// OpenRouter free-tier model chains (these rotate as free models get rate-limited).
const OPENROUTER_JSON_CHAIN = [
  process.env.OPENROUTER_MODEL_JSON,
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

const OPENROUTER_PROSE_CHAIN = [
  process.env.OPENROUTER_MODEL,
  'nvidia/nemotron-3-super-120b-a12b:free',
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
];

// Gemini is an independent, third provider. Keep the configured model first, but
// retain known-good defaults (`gemini-3.6-flash` is the current generation;
// `gemini-flash-latest` is Google's rolling alias) so a stale pinned model does
// not disable Gemini.
const GEMINI_CHAIN = [
  process.env.GEMINI_TEXT_MODEL,
  'gemini-3.6-flash',
  'gemini-flash-latest',
];

// Mistral is the fourth provider — excellent for structured JSON and editorial tasks.
// Live-tested against api.mistral.ai (14 Sep 2026):
//   - `mistral-medium-3-5` is the user's configured flagship (valid — reaches
//     rate-limiting, not model validation).
//   - `mistral-large-2411` returns HTTP 400 "Invalid model" — DO NOT USE.
//   - `mistral-large-latest` returns 403 tier_not_allowed on free/lower tiers.
//   - `mistral-small-2503` / `mistral-small-latest` are valid, cheaper backups.
// NOTE: these are BARE model names (no provider prefix) — valid for the Mistral
// API but invalid for NVIDIA NIM.  This chain is only used with the Mistral
// provider, so bare names are correct here.
const MISTRAL_CHAIN = [
  process.env.MISTRAL_MODEL,
  'mistral-medium-3-5',
  'mistral-small-2503',
  'mistral-small-latest',
];

function buildChain(...models: (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of models) {
    const id = (m ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Run one model id list against `fn` until one succeeds. Throws an aggregate error listing each attempt. */
async function tryModelChain<T>(
  label: string,
  models: string[],
  fn: (model: string) => Promise<T>
): Promise<T> {
  const errors: string[] = [];
  for (const model of models) {
    // Budget guard: rotating through another model that cannot possibly finish
    // before the platform freezes this function is worse than stopping — the
    // freeze orphans the job's lease and the UI sits on "Queued...". Throwing
    // here lets the queue re-queue the job (with backoff) and resume from the
    // worker's own checkpoint on the next claim.
    if (!hasBudgetForAttempt()) {
      throw new LlmBudgetExceededError(
        `LLM_BUDGET_EXCEEDED: claim window closed while rotating ${label} ` +
          `(${models.length} model(s), ${errors.length} already failed -> ${errors.join(' | ')})`
      );
    }
    try {
      return await fn(model);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${model}: ${msg}`);
      console.warn(`[LLM] ${label} model ${model} failed:`, msg);
      // A budget error is not a model problem — propagate immediately instead
      // of burning the remaining chain on it.
      if (isLlmBudgetExceeded(error)) throw error;
      // Continue to the next model in the chain.
    }
  }
  throw new Error(`${label}: all ${models.length} model(s) failed -> ${errors.join(' | ')}`);
}

/**
 * Turn the 4-provider aggregate failure into something a user can act on.
 * `allProvidersTransient` is re-exported from budget.ts for the busy check.
 */
function friendlyAllProviderError(errors: string[]): string {
  if (errors.some((e) => isProviderTransientError(e)) && errors.every((e) => isProviderTransientError(e))) {
    return (
      'All AI providers are temporarily overloaded (HTTP 503/429). ' +
      'This is not a problem with your book — retry generation in a few minutes. ' +
      'Details: ' +
      errors.map((e) => e.slice(0, 160)).join(' | ')
    );
  }
  return (
    'Text generation failed across all providers. OpenRouter: ' + errors[0] +
    '. NVIDIA NIM: ' + (errors[1] ?? 'n/a') +
    '. Google Gemini: ' + (errors[2] ?? 'n/a') +
    '. Mistral: ' + (errors[3] ?? 'n/a') + '.'
  );
}

function safetyMessage(errors: string[]): string | null {
  for (const e of errors) {
    const m = e.match(/Safety Categories:([^\n]+)/i);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

export async function askLLMJSONWithFallback<T>(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.2,
  preferredModel?: string
): Promise<T> {
  // `preferredModel` is a caller-curated model id (e.g. EDITORIAL_REVIEW_MODEL,
  // usually a bare Mistral name). Bare names are ONLY valid for the Mistral API —
  // sending them to NVIDIA NIM 404s (this was the production 404 noise). Guard
  // the NIM chain from it, and prepend it to the Mistral chain where it belongs.
  const nimPreferred = preferredModel && isValidNimModel(preferredModel) ? preferredModel : undefined;
  const nimModels = buildChain(nimPreferred, ...NIM_JSON_CHAIN);
  const orModels = buildChain(...OPENROUTER_JSON_CHAIN);
  const geminiModels = buildChain(...GEMINI_CHAIN);
  const mistralModels = buildChain(preferredModel, ...MISTRAL_CHAIN);

  try {
    return await tryModelChain('OpenRouter', orModels, (m) =>
      askLLMJSON<T>(systemPrompt, userPrompt, temperature, m)
    );
  } catch (openrouterError) {
    const orMessage = openrouterError instanceof Error ? openrouterError.message : String(openrouterError);
    console.warn('[LLM] OpenRouter chain exhausted, falling back to NVIDIA NIM:', orMessage);

    try {
      return await tryModelChain('NVIDIA NIM', nimModels, (m) =>
        askLLMNimJSON<T>(systemPrompt, userPrompt, temperature, m)
      );
    } catch (nimError) {
      const nimMessage = nimError instanceof Error ? nimError.message : String(nimError);
      console.warn('[LLM] NVIDIA NIM chain exhausted, falling back to Gemini:', nimMessage);

      try {
        return await tryModelChain('Google Gemini', geminiModels, (m) =>
          askLLMGeminiJSON<T>(systemPrompt, userPrompt, temperature, m)
        );
      } catch (geminiError) {
        const geminiMessage = geminiError instanceof Error ? geminiError.message : String(geminiError);
        console.warn('[LLM] Gemini chain exhausted, falling back to Mistral:', geminiMessage);

        try {
          return await tryModelChain('Mistral', mistralModels, (m) =>
            askLLMMistralJSON<T>(systemPrompt, userPrompt, temperature, m)
          );
        } catch (mistralError) {
          const mistralMessage = mistralError instanceof Error ? mistralError.message : String(mistralError);

          // Surface a friendly safety-filter error if any attempt was content-blocked.
          const safety = safetyMessage([orMessage, nimMessage, geminiMessage, mistralMessage]);
          if (safety) {
            throw new Error(
              `Content flagged by safety filter: ${safety}. Try adjusting book themes or descriptions.`
            );
          }

          const all = [orMessage, nimMessage, geminiMessage, mistralMessage];
          // Out-of-budget is a platform signal, not a content/model failure: keep
          // it as LlmBudgetExceededError so the queue re-queues (with backoff)
          // instead of treating the book as permanently failed.
          if (all.some((m) => isLlmBudgetExceeded(m))) {
            throw new LlmBudgetExceededError(
              `${LLM_BUDGET_EXCEEDED_CODE}: this request ran out of its time window -> ${all[0]}`
            );
          }
          throw new Error(friendlyAllProviderError(all));
        }
      }
    }
  }
}

/**
 * Free-form text generation (chapter prose). Rotates through prose-optimized
 * models across OpenRouter, then NVIDIA NIM, then Google Gemini, then Mistral. `maxTokens` must be
 * large enough for a full chapter.
 */
export async function askLLMWithFallback(
  systemPrompt: string,
  userPrompt: string,
  temperature: number = 0.7,
  maxTokens: number = 8192,
  preferredModel?: string
): Promise<string> {
  // Same guard as askLLMJSONWithFallback: never send a bare (non-NIM) model id
  // to the NVIDIA NIM chain; prefer it on the Mistral chain instead.
  const nimPreferred = preferredModel && isValidNimModel(preferredModel) ? preferredModel : undefined;
  const nimModels = buildChain(nimPreferred, ...NIM_PROSE_CHAIN);
  const orModels = buildChain(...OPENROUTER_PROSE_CHAIN);
  const geminiModels = buildChain(...GEMINI_CHAIN);
  const mistralModels = buildChain(preferredModel, ...MISTRAL_CHAIN);

  try {
    return await tryModelChain('OpenRouter', orModels, (m) =>
      askLLM(systemPrompt, userPrompt, temperature, m, maxTokens)
    );
  } catch (openrouterError) {
    const orMessage = openrouterError instanceof Error ? openrouterError.message : String(openrouterError);
    console.warn('[LLM] OpenRouter prose chain exhausted, falling back to NVIDIA NIM:', orMessage);

    try {
      return await tryModelChain('NVIDIA NIM', nimModels, (m) =>
        askLLMNim(systemPrompt, userPrompt, temperature, m, maxTokens)
      );
    } catch (nimError) {
      const nimMessage = nimError instanceof Error ? nimError.message : String(nimError);
      console.warn('[LLM] NVIDIA NIM prose chain exhausted, falling back to Gemini:', nimMessage);

      try {
        return await tryModelChain('Google Gemini', geminiModels, (m) =>
          askLLMGemini(systemPrompt, userPrompt, temperature, m, maxTokens)
        );
      } catch (geminiError) {
        const geminiMessage = geminiError instanceof Error ? geminiError.message : String(geminiError);
        console.warn('[LLM] Gemini prose chain exhausted, falling back to Mistral:', geminiMessage);

        try {
          return await tryModelChain('Mistral', mistralModels, (m) =>
            askLLMMistral(systemPrompt, userPrompt, temperature, m, maxTokens)
          );
        } catch (mistralError) {
          const mistralMessage = mistralError instanceof Error ? mistralError.message : String(mistralError);
          const safety = safetyMessage([orMessage, nimMessage, geminiMessage, mistralMessage]);
          if (safety) {
            throw new Error(
              `Content flagged by safety filter: ${safety}. Try adjusting book themes or descriptions.`
            );
          }

          const all = [orMessage, nimMessage, geminiMessage, mistralMessage];
          // Out-of-budget is a platform signal, not a content/model failure: keep
          // it as LlmBudgetExceededError so the queue re-queues (with backoff)
          // instead of treating the book as permanently failed.
          if (all.some((m) => isLlmBudgetExceeded(m))) {
            throw new LlmBudgetExceededError(
              `${LLM_BUDGET_EXCEEDED_CODE}: this request ran out of its time window -> ${all[0]}`
            );
          }
          throw new Error(friendlyAllProviderError(all));
        }
      }
    }
  }
}
