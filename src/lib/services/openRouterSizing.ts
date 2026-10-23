// HydraSkript - OpenRouter Images sizing
//
// The unified OpenRouter Images API sizes pictures with `aspect_ratio` +
// `resolution` (a tier), not raw pixel dimensions. Sending `size: "1344x768"`
// worked on paper but silently killed the backend in production: the default
// model (bytedance-seed/seedream-4.5) refuses outputs under 3,686,400 px, so
// every request 400'd and the chain fell through to Pollinations even with
// IMAGE_BACKEND_ORDER=openrouter-first. These helpers map our internal WxH
// canvases onto the unified parameters and read size rejections so the retry
// loop can walk the resolution tier in the direction the model asked for.

/**
 * Resolution tiers we walk between. '2K' clears Seedream's 3.69MP floor at
 * every supported ratio (16:9 → 2560x1440 = exactly 3,686,400px; 1:1 →
 * 2048x2048). '512' is deliberately excluded — useless for book art.
 */
export const RESOLUTION_TIERS = ['1K', '2K', '4K'] as const;

const DEFAULT_TIER_INDEX = 1; // '2K'

/** Starting tier index from OPENROUTER_IMAGE_RESOLUTION (default '2K'). */
export function tierIndexForResolution(envValue?: string): number {
  const wanted = (envValue ?? '').trim().toUpperCase();
  const idx = (RESOLUTION_TIERS as readonly string[]).indexOf(wanted);
  return idx >= 0 ? idx : DEFAULT_TIER_INDEX;
}

// The aspect ratios the unified API documents. (Gemini image models also
// accept exotic 1:4/4:1/1:8/8:1; nothing we generate is that shape.)
const ASPECT_RATIOS = ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const;

/** Nearest supported aspect ratio for a WxH canvas, compared in log space. */
export function nearestAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1';
  const target = Math.log(width / height);
  let best: string = '1:1';
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const ratio of ASPECT_RATIOS) {
    const [rw, rh] = ratio.split(':').map(Number);
    const diff = Math.abs(Math.log(rw / rh) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }
  return best;
}

/**
 * The pixel floor named in a size rejection, e.g. Seedream's
 * "requires at least 3,686,400 output pixels". Null when the message names
 * no number (the direction can still be classified without it).
 */
export function parseMinimumPixels(errorMsg: string): number | null {
  const match =
    /at least ([\d,]+) *(?:output )?pixels/i.exec(errorMsg) ??
    /minimum(?: of)? ([\d,]+) *(?:output )?pixels/i.exec(errorMsg);
  if (!match) return null;
  const value = parseInt(match[1].replace(/,/g, ''), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The resolution tier a provider NAMED as acceptable in its rejection,
 * e.g. Gemini flash-lite-image's "resolution: not supported. Accepted:
 * 1K" — returned as an index into RESOLUTION_TIERS so the caller can jump
 * straight to it. Tiers below our ladder (512/768) clamp to '1K'. Null
 * when the message names no accepted tier.
 */
export function parseAcceptedTierIndex(errorMsg: string): number | null {
  // Require an acceptance lead-in ("Accepted: 1K", "Supported resolutions:
  // 512, 1K, 2K", "valid values are 1K and 2K") so stray numbers elsewhere
  // in an error can't steer sizing. Word boundaries keep "Unsupported
  // parameter" from matching as an acceptance.
  const match =
    /\b(?:accepted|supported|valid|allowed)\b[^.]*?((?:\d+(?:\.\d+)?K|512|768)(?:\s*(?:,|or|and)\s*(?:\d+(?:\.\d+)?K|512|768))*)/i.exec(errorMsg);
  if (!match) return null;
  // When several tiers are named, take the largest our ladder knows;
  // sub-ladder tokens (512/768) clamp to the bottom tier.
  const tiers = match[1].match(/\d+(?:\.\d+)?K|512|768/gi) ?? [];
  let best: number | null = null;
  for (const tier of tiers) {
    const idx = (RESOLUTION_TIERS as readonly string[]).indexOf(tier.toUpperCase());
    const clamped = idx >= 0 ? idx : 0;
    best = best === null ? clamped : Math.max(best, clamped);
  }
  return best;
}

/**
 * Which way a size rejection wants the canvas moved. Deliberately narrow:
 * generic "unsupported parameter" errors must return null so the
 * strip-level ladder (drop optional fields → bare request) handles them
 * instead of the tier walk. (Rejections that NAME an accepted tier are
 * handled before this via parseAcceptedTierIndex; a bare "resolution …
 * not supported" reads as a ceiling and steps down.)
 */
export function classifySizeError(errorMsg: string): 'too-small' | 'too-large' | null {
  if (
    /at least [\d,]+ *(?:output )?pixels/i.test(errorMsg) ||
    /\btoo small\b/i.test(errorMsg) ||
    /larger (?:size|resolution|canvas)/i.test(errorMsg) ||
    /minimum[^.]*\b(?:size|resolution|pixels|dimensions?)\b/i.test(errorMsg)
  ) {
    return 'too-small';
  }
  if (
    /at most [\d,]+ *(?:output )?pixels/i.test(errorMsg) ||
    /\btoo large\b/i.test(errorMsg) ||
    /smaller (?:size|resolution|canvas)/i.test(errorMsg) ||
    /maximum[^.]*\b(?:size|resolution|pixels|dimensions?)\b/i.test(errorMsg) ||
    /exceeds?[^.]*\b(?:size|resolution|pixels)\b/i.test(errorMsg) ||
    /resolution[^.]{0,40}\bnot supported\b/i.test(errorMsg)
  ) {
    return 'too-large';
  }
  return null;
}
