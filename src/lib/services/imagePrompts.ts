// HydraSkript - Image Prompt Composition
//
// Pure helpers (no I/O, no database) that decide what the image backends are
// actually asked for. Kept in their own module so they can be unit tested
// without booting Prisma or the storage layer.

import { STYLE_CONFIG } from '@/types';

const LINE_ART_STYLES = new Set(['lineart', 'lineart-adult']);

/**
 * Negative prompt for full-color illustrated assets.
 *
 * "Not really Pixar" almost always means the model drifted into one of these
 * modes: a flat 2D cartoon, a photograph, an anime cel, or a page of random
 * lettering. Naming them explicitly is what pulls the model back into the
 * stylized 3D look — the positive prompt alone cannot prevent the drift.
 */
export const ILLUSTRATION_NEGATIVE_PROMPT = [
  'photograph',
  'photorealistic',
  'live action',
  'real person',
  'anime',
  'manga',
  '2d cartoon',
  'flat vector',
  'cel shading',
  'comic book halftone',
  'sketch',
  'pencil drawing',
  'pen and ink',
  'watercolor painting',
  'oil painting',
  'gouache',
  'claymation',
  'plastic doll',
  'uncanny',
  'photographic texture',
  'text',
  'letters',
  'words',
  'caption',
  'subtitle',
  'speech bubble',
  'watermark',
  'signature',
  'logo',
  'deformed',
  'disfigured',
  'extra limbs',
  'extra fingers',
  'fused fingers',
  'mutated hands',
  'blurry',
  'low quality',
  'jpeg artifacts',
  'cropped',
  'out of frame',
].join(', ');

/** Negative prompt for coloring pages / line art. */
export const LINE_ART_NEGATIVE_PROMPT = [
  'color',
  'colorful',
  'shading',
  'gradient',
  'grayscale',
  'painting',
  '3d',
  'photorealistic',
  'filled',
  'solid black areas',
  'text',
  'watermark',
].join(', ');

/**
 * Style-specific negative prompts for the AI Cover Designer presets. These
 * styles are not illustrations, so the illustration negative prompt would
 * contradict them (negating "photograph" would flatten a noir cover, and so on).
 */
const COVER_STYLE_NEGATIVE_PROMPTS: Record<string, string> = {
  noir: 'color, cartoon, anime, 3d render, text, letters, watermark, signature, blurry, low quality',
  cyberpunk: 'black and white, greyscale, monochrome, sketch, watercolor, blurry, low quality, text, letters, watermark, signature',
  minimalist: 'busy clutter, photorealistic texture, noisy background, heavy detail, blurry, low quality, text, letters, watermark, signature',
};

/**
 * Pick the negative prompt that matches the asset being generated.
 * Line art must be pushed AWAY from color; full-color illustrations must be
 * pushed away from every non-Pixar look that competes with the style anchor.
 */
export function buildNegativePrompt(style: string, assetType: string): string {
  if (assetType === 'coloring_page' || LINE_ART_STYLES.has(style)) {
    return LINE_ART_NEGATIVE_PROMPT;
  }
  if (COVER_STYLE_NEGATIVE_PROMPTS[style]) {
    return COVER_STYLE_NEGATIVE_PROMPTS[style];
  }
  if (style === 'realistic') {
    return 'illustration, cartoon, 3d render, drawing, painting, text, letters, watermark, signature, deformed, blurry, low quality';
  }
  return ILLUSTRATION_NEGATIVE_PROMPT;
}

/**
 * Compose the final prompt: style anchor FIRST (models weight the head of a
 * prompt most heavily), the scene in the middle, and the style anchor again
 * LAST (models also weight the tail — repeating it stops the scene text from
 * washing the look out, which is what "not really Pixar" looked like).
 */
export function composeImagePrompt(styleKey: string, scene: string): string {
  const styleConfig = STYLE_CONFIG[styleKey] || STYLE_CONFIG.pixar;
  // Normalise the scene into a single clause: no double spaces, no doubled
  // full stops, and no trailing full stop (one is added when it is joined).
  const sceneText = scene
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .replace(/[.\s]+$/, '');
  const tail = styleConfig.tail?.trim();
  return tail
    ? `${styleConfig.prompt}. ${sceneText}. ${tail}`
    : `${styleConfig.prompt}. ${sceneText}`;
}

/**
 * Image backends, in the order they are attempted.
 */
export type ImageBackend = 'pollinations' | 'openrouter' | 'stability' | 'pruna';

export const BACKEND_LABELS: Record<ImageBackend, string> = {
  pollinations: 'Pollinations AI',
  openrouter: 'OpenRouter Images',
  stability: 'Stability AI',
  pruna: 'Pruna AI',
};

const DEFAULT_BACKEND_ORDER: ImageBackend[] = [
  'pollinations',
  'openrouter',
  'stability',
  'pruna',
];

/**
 * Resolve the backend order.
 *
 * The default keeps the historical behaviour (Pollinations first) so nothing
 * changes for a working deployment. `IMAGE_BACKEND_ORDER` overrides it, e.g.
 *
 *   IMAGE_BACKEND_ORDER=openrouter,pollinations,stability,pruna
 *
 * puts OpenRouter's Seedream 4.5 in front — it follows style and scene
 * instructions far more literally than Pollinations' flux, which is the
 * quickest lever on "the art is not really Pixar".
 */
export function resolveBackendOrder(style: string, assetType: string): ImageBackend[] {
  const needsLineArt = assetType === 'coloring_page' || LINE_ART_STYLES.has(style);
  const fallback: ImageBackend[] = needsLineArt
    ? [...DEFAULT_BACKEND_ORDER]
    : [...DEFAULT_BACKEND_ORDER];

  const configured = (process.env.IMAGE_BACKEND_ORDER || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ImageBackend => s in BACKEND_LABELS);

  if (configured.length === 0) return fallback;

  // Keep the default tail for any backend the operator did not mention.
  const seen = new Set<ImageBackend>();
  const result: ImageBackend[] = [];
  for (const backend of configured) {
    if (seen.has(backend)) continue;
    seen.add(backend);
    result.push(backend);
  }
  for (const backend of fallback) {
    if (!seen.has(backend)) {
      seen.add(backend);
      result.push(backend);
    }
  }
  return result;
}
