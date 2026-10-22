// HydraSkript - Illustration QA Gate
//
// Prompting can only take a one-shot image model so far: occasionally the
// backend returns a perfectly valid picture of entirely the wrong thing —
// the production case was a generic "girl with animal friends" portrait
// (bear, dinosaur, tiger) for a chapter about a girl, her father and their
// black lab searching under a table. Nothing downstream could tell: the
// image was valid, full-colour, on-style. Just wrong.
//
// This gate closes that hole structurally: after a chapter illustration is
// generated, a cheap vision model checks it against the cast census and the
// scene it was asked to draw. On mismatch the caller re-rolls with a new
// seed. The gate is FAIL-OPEN by design — no API key, provider storm, bad
// JSON, timeout: the image is accepted unchecked. QA may delay a picture by
// seconds; it must never cost a book its artwork.
//
// Env: IMAGE_QA_ENABLED=false disables the gate. IMAGE_QA_MODEL overrides
// the first vision model tried (OpenRouter slug).

import type { CharacterSheetEntry } from '@/lib/services/characterSheet';

export interface QAVerdict {
  match: boolean;
  problems: string[];
}

export interface QAResult {
  accept: boolean;
  /** False when QA could not run and the image was accepted unchecked. */
  checked: boolean;
  reason: string;
}

const QA_TIMEOUT_MS = 20_000;
const MAX_QA_MODELS = 3;

const QA_SYSTEM_PROMPT = `You are a strict but fair quality checker for a children's picture book. You will be shown one generated image and told exactly which characters it must contain and what scene it was asked to show.

Answer match=false ONLY for these failures:
- A listed character is missing, appears more than once, or an extra person or animal is present who is not listed.
- An animal character is drawn as the wrong species (a cat instead of the dog, a tiger/bear/dinosaur instead of the named pet).
- A child character is drawn as an adult or teenager.
- A human character has animal features (animal ears, fur, a tail, a snout, paws).
- The image shows a completely different setting or activity from the scene description.

Answer match=true when the listed characters are all there exactly once, the animals are the right species, and the scene is recognisably the one described — minor differences in pose, props, clothing details or cropping are FINE.

Count the beings in the image carefully before answering. Reply with ONLY a JSON object, no other text:
{"match": true, "problems": []} or {"match": false, "problems": ["short reason", "..."]}`;

/** The QA instructions for one frame: who must be in it, and what it must show. */
export function buildQAPrompt(scene: string, cast: CharacterSheetEntry[]): { system: string; user: string } {
  const castLines = cast.map((entry) => {
    const kind = entry.isAnimal ? `${entry.countNoun} (animal)` : entry.countNoun;
    const look = entry.descriptor.trim() ? ` — ${entry.descriptor.trim()}` : '';
    return `- ${entry.name}: a ${kind}${look}`;
  });
  const user = [
    'Expected characters (each must appear exactly once, and no other people or animals):',
    ...castLines,
    '',
    'Scene the picture was asked to show:',
    scene.trim(),
  ].join('\n');
  return { system: QA_SYSTEM_PROMPT, user };
}

/** Salvage the verdict JSON from a possibly fenced or chatty model reply. */
export function parseQAVerdict(raw: string): QAVerdict | null {
  if (!raw) return null;
  const text = raw.replace(/```(?:json)?/gi, ' ');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof parsed.match !== 'boolean') return null;
    const problems = Array.isArray(parsed.problems)
      ? parsed.problems.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).slice(0, 6)
      : [];
    return { match: parsed.match, problems };
  } catch {
    return null;
  }
}

/**
 * Vision models to try, in order. The free Gemma (already used across this
 * app, multimodal) goes first; cheap paid vision models back it up because
 * free-tier rate limits are exactly when books are being generated.
 */
function qaModelCandidates(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [process.env.IMAGE_QA_MODEL, 'google/gemma-4-31b-it:free', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini']) {
    const id = (m ?? '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(0, MAX_QA_MODELS);
}

function extractReplyText(data: unknown): string {
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
      .join(' ');
  }
  return '';
}

/**
 * Check one generated illustration against its cast + scene. Never throws:
 * any inability to check resolves to "accepted, unchecked" so QA can never
 * block illustration generation.
 */
export async function verifyIllustration(opts: {
  imageUrl: string;
  scene: string;
  cast: CharacterSheetEntry[];
}): Promise<QAResult> {
  const accepted = (reason: string): QAResult => ({ accept: true, checked: false, reason });
  try {
    if (process.env.IMAGE_QA_ENABLED === 'false') return accepted('QA disabled by IMAGE_QA_ENABLED=false');
    if (!opts.imageUrl || !/^https?:\/\//i.test(opts.imageUrl)) return accepted('no fetchable image URL to check');
    if (!opts.cast || opts.cast.length === 0) return accepted('no cast to check against');

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY;
    if (!apiKey) return accepted('no OpenRouter API key for QA');

    const { system, user } = buildQAPrompt(opts.scene, opts.cast);

    for (const model of qaModelCandidates()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), QA_TIMEOUT_MS);
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 240,
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content: [
                  { type: 'text', text: user },
                  { type: 'image_url', image_url: { url: opts.imageUrl } },
                ],
              },
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.warn(`[ImageQA] ${model} returned HTTP ${response.status}, trying next model`);
          continue;
        }

        const verdict = parseQAVerdict(extractReplyText(await response.json()));
        if (!verdict) {
          console.warn(`[ImageQA] ${model} returned an unparseable verdict, trying next model`);
          continue;
        }

        return verdict.match
          ? { accept: true, checked: true, reason: `QA match (${model})` }
          : { accept: false, checked: true, reason: verdict.problems.join('; ') || `QA mismatch (${model})` };
      } catch (e) {
        console.warn(`[ImageQA] ${model} check failed:`, e instanceof Error ? e.message : e);
        // try the next candidate model
      } finally {
        clearTimeout(timer);
      }
    }

    return accepted('QA unavailable — accepted unchecked');
  } catch (e) {
    console.warn('[ImageQA] verification failed (non-fatal):', e instanceof Error ? e.message : e);
    return accepted('QA error — accepted unchecked');
  }
}
