// HydraSkript - Image Generation Service (Hardened for Coloring Books)
// Fallback chain: Pollinations AI (default) → OpenRouter Images API → Stability AI → Pruna AI.
// The order is overridable with the IMAGE_BACKEND_ORDER env var.
import { saveBase64File, generateFilename, createMediaAsset } from '@/lib/utils/storage';
import { COLORING_THEMES } from '@/types';
import {
  buildNegativePrompt,
  composeImagePrompt,
  deriveImageSeed,
  resolveBackendOrder,
  BACKEND_LABELS,
  type ImageBackend,
} from '@/lib/services/imagePrompts';
import type { ColoringTheme, TargetAudience } from '@/types';
import type { CharacterSheet } from '@/lib/services/characterSheet';
import { anchorSceneWithSheet, buildChildrenCoverScene, buildExactCountClause } from '@/lib/services/characterSheet';

type ImageSize = '1024x1024' | '768x1344' | '864x1152' | '1344x768' | '1152x864' | '1440x720' | '720x1440';

export interface GenerateImageOptions {
  prompt: string;
  style?: string;
  size?: ImageSize;
  ownerId: string;
  bookId?: string;
  assetType: string;
  negativePrompt?: string;
  /**
   * Identifies the specific picture within the book (e.g. "chapter-3",
   * "cover"). Part of the seed derivation so two different illustrations in
   * the same book never start from the same latent noise.
   */
  seedSalt?: string;
}

export interface GeneratedImageResult {
  success: boolean;
  publicUrl?: string;
  assetId?: string;
  error?: string;
  /** The exact prompt that was sent to the backend (style anchor + scene). */
  prompt?: string;
}

const LINE_ART_STYLES = new Set(['lineart', 'lineart-adult']);

/**
 * Detect a degenerate generation: a flat, near-contentless image (a uniform gray
 * or blank wash). Pollinations periodically returns these for line-art prompts,
 * and no amount of post-processing can pull colorable contours out of them, so
 * they must be rejected and regenerated with a different seed.
 */
async function isDegenerateImage(buffer: Buffer): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default;
    const stats = await sharp(buffer).stats();
    // A flat gray/white/black wash has almost no tonal variation (stdev ~0-30),
    // while a drawing — even a faint sketch — spans a wide tonal range. Real
    // line-art input measures ~40+ stdev, so anything flatter than 32 is a
    // contentless box that no post-processing can turn into a coloring page.
    return stats.channels[0].stdev < 32;
  } catch {
    return true;
  }
}

/**
 * Mean HSV saturation of an image (0 = greyscale, 1 = fully saturated).
 * Returns 1 when the image cannot be analysed so the gate never blocks
 * generation on an analysis error.
 */
async function meanSaturation(buffer: Buffer): Promise<number> {
  try {
    const sharp = (await import('sharp')).default;
    const { data, info } = await sharp(buffer)
      .resize(64, 64, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const channels = info.channels || 3;
    const pixels = info.width * info.height;
    let sum = 0;
    for (let i = 0; i < data.length; i += channels) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      sum += max === 0 ? 0 : (max - min) / max;
    }
    return pixels > 0 ? sum / pixels : 1;
  } catch {
    return 1;
  }
}

/**
 * Full-colour quality gate.
 *
 * A Pixar frame is vivid. When a model ignores the style anchor it drifts
 * into a grey, desaturated or monochrome render — which reads as "not really
 * Pixar" no matter how good the prompt was. Rejecting those frames re-rolls the
 * seed (and, once the retries are spent, hands the job to the next backend).
 *
 * The threshold is deliberately low so a moody but colourful scene still
 * passes; only washed-out/greyscale output is rejected.
 */
const MIN_ILLUSTRATION_SATURATION = 0.15;

async function isFullColorUsable(buffer: Buffer, options: GenerateImageOptions): Promise<boolean> {
  if (options.style !== 'pixar') return true;
  if (options.assetType === 'coloring_page') return true;
  const saturation = await meanSaturation(buffer);
  if (saturation < MIN_ILLUSTRATION_SATURATION) {
    console.warn(
      `[imageService] color gate reject: saturation ${saturation.toFixed(3)} < ${MIN_ILLUSTRATION_SATURATION} (image is washed out / greyscale)`
    );
    return false;
  }
  return true;
}

/**
 * Post-conversion gate: a usable coloring page has a healthy line density
 * (about 0.8-12% black, matching real coloring-book page coverage) over a
 * mostly-white page. Below that it reads as blank; above it as a blob. Also
 * rejects pages with solid black bands (e.g. a Pollinations caption strip or a
 * baked-in shadow bar), which padding with ink cannot fix.
 */
async function isLineArtUsable(pngBuffer: Buffer): Promise<boolean> {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(pngBuffer).metadata();
    const gray = await sharp(pngBuffer).flatten({ background: '#fff' }).grayscale().raw().toBuffer();
    const { width: W, height: H } = meta;
    let black = 0;
    let white = 0;
    for (const v of gray) {
      if (v < 40) black++;
      else if (v >= 230) white++;
    }
    const blackFraction = black / gray.length;
    const whiteFraction = white / gray.length;
    if (blackFraction < 0.008 || blackFraction > 0.12 || whiteFraction < 0.7) {
      console.warn(`[gate-debug] density reject: black=${(blackFraction * 100).toFixed(1)}% white=${(whiteFraction * 100).toFixed(1)}%`);
      return false;
    }

    // Median horizontal stroke width. The reader renders a 1024px page at about
    // half size, so 1px hairlines wash out to nothing and the page reads as a
    // blank sheet. A usable page keeps its median stroke at 2px or more.
    const widths: number[] = [];
    for (let y = 0; y < H; y++) {
      let run = 0;
      for (let x = 0; x <= W; x++) {
        const black = x < W && gray[y * W + x] < 128;
        if (black) {
          run++;
        } else if (run > 0) {
          widths.push(run);
          run = 0;
        }
      }
    }
    if (widths.length < 50) {
      console.warn(`[gate-debug] too-few-strokes reject: ${widths.length}`);
      return false;
    }
    widths.sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)];
    if (medianWidth < 2) {
      console.warn(`[gate-debug] hairline reject: median stroke ${medianWidth}px`);
      return false;
    }

    let run = 0;
    for (let y = 0; y < H; y++) {
      let rowBlack = 0;
      for (let x = 0; x < W; x++) {
        if (gray[y * W + x] < 40) rowBlack++;
      }
      if (rowBlack / W > 0.55) {
        run++;
        if (run > Math.max(4, H * 0.02)) { console.warn(`[gate-debug] row-band reject: ${run} rows at row=${y}`); return false; }
      } else {
        run = 0;
      }
    }

    // Full-height solid strips (the vertical frame edge Pollinations often
    // bakes into the image). Two adjacent columns that are >80% dark for the
    // entire height is a border, not a drawing.
    run = 0;
    for (let x = 0; x < W; x++) {
      let colBlack = 0;
      for (let y = 0; y < H; y++) {
        if (gray[y * W + x] < 40) colBlack++;
      }
      if (colBlack / H > 0.8) {
        run++;
        if (run >= 2) { console.warn(`[gate-debug] col-strip reject: ${run} cols at x=${x}`); return false; }
      } else {
        run = 0;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the gray value at which the darkest `fraction` of pixels sit. Keeps line
 * strokes at a healthy, visible thickness instead of the hairline edges that a
 * pure edge detector leaves behind on faint Pollinations sketches.
 */
function percentileThreshold(grayRaw: Buffer, fraction: number): number {
  const hist = new Float64Array(256);
  for (const v of grayRaw) hist[v]++;
  let target = Math.floor(grayRaw.length * fraction);
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/**
 * Fraction of mid-tone pixels (not near-black, not near-white) that do NOT sit
 * near any black ink. Real line art: mid pixels are anti-aliasing along dark
 * contours, so they always touch black. A shaded grayscale illustration: mid
 * pixels form broad regions far from any line. This is what tells the two
 * apart — RGB channel spread can't, because every grayscale image scores ~0.
 * Buckets pixels into 4x4 blocks and checks a 3x3 block neighborhood.
 */
function shadedMidFraction(grayRaw: Buffer, width: number, height: number): number {
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const dark = new Uint8Array(bw * bh);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (grayRaw[off + x] < 40) dark[(y >> 2) * bw + (x >> 2)] = 1;
    }
  }
  let mid = 0;
  let midFar = 0;
  for (let y = 0; y < height; y++) {
    const off = y * width;
    const by = y >> 2;
    for (let x = 0; x < width; x++) {
      const v = grayRaw[off + x];
      if (v < 40 || v >= 230) continue;
      mid++;
      const bx = x >> 2;
      let near = 0;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= bh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx;
          if (xx >= 0 && xx < bw && dark[yy * bw + xx]) { near = 1; break; }
        }
      }
      if (!near) midFar++;
    }
  }
  return mid > 0 ? midFar / mid : 0;
}

/**
 * Convert a colored OR shaded-grayscale image into clean black-and-white line art.
 *
 * The image backends are asked for "black and white line art", but they often
 * return a *shaded* picture instead — full color from Pollinations, or a
 * grayscale illustration with gradients/shadows from a model that half-followed
 * the prompt. Neither is colorable. Two things were wrong before:
 *   1. The old guard skipped any image whose RGB channel means were close
 *      (i.e. grayscale), so a shaded grayscale image was stored untouched — the
 *      exact "black and white but not colorable" complaint.
 *   2. A plain threshold turns every shaded region into a solid black blob.
 *
 * Instead we run a Difference of Gaussians: the local mean minus the image keeps
 * thin dark contours while cancelling large-scale shading, so shadows do not
 * fill in. We then thicken the hairlines so there is room to color between them.
 *
 * Returns null only when the image already looks like clean line art (light and
 * near-grayscale), so good output from a capable backend is left untouched.
 */
async function toLineArtBase64(base64: string, mimeType: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const sharp = (await import('sharp')).default;
    const input = Buffer.from(base64, 'base64');

    const stats = await sharp(input).stats();
    const means = stats.channels.slice(0, 3).map((c) => c.mean);
    const spread = Math.max(...means) - Math.min(...means);

    // Distinguish genuine line art from a shaded or faint illustration. Both can
    // be near-grayscale and light, so luminance alone is not enough: only real
    // line art already has a healthy amount of solid black (the contours) next
    // to a mostly-white page. A faint wash has almost no true black; a shaded
    // picture has too much ink. Re-running the extractor on good line art fills
    // it into a black blob, so this skip matters.
    const grayRaw = await sharp(input).grayscale().raw().toBuffer();
    const meta = await sharp(input).metadata();
    let black = 0;
    let white = 0;
    for (const v of grayRaw) {
      if (v < 40) black++;
      else if (v >= 230) white++;
    }
    const blackFraction = black / grayRaw.length;
    const whiteFraction = white / grayRaw.length;
    const midFar = meta.width && meta.height ? shadedMidFraction(grayRaw, meta.width, meta.height) : 1;
    const alreadyLineArt = Number.isFinite(spread) && spread <= 10
      && blackFraction >= 0.008 && blackFraction <= 0.2 && whiteFraction >= 0.6
      && midFar <= 0.45;
    if (alreadyLineArt) return null;

    const gray = await sharp(input).grayscale().png().toBuffer();
    const localMean = await sharp(gray).blur(6).png().toBuffer();
    const dog = await sharp(localMean)
      .composite([{ input: gray, blend: 'difference' }])
      .png()
      .toBuffer();
    const edges = await sharp(dog).linear(6, 0).threshold(30).png().toBuffer();

    let union: Buffer;
    if (blackFraction >= 0.015) {
      // Darker illustration with real ink: keep only contours so fills, shadows
      // and baked-in black bands never turn into solid blobs.
      union = edges;
    } else {
      // Faint/mid sketch: keep the darkest ~4% as thick visible strokes, then
      // union with the contours so interior detail survives.
      const t = percentileThreshold(grayRaw, 0.04);
      const ink = await sharp(gray).threshold(t).negate().png().toBuffer();
      union = await sharp(edges).composite([{ input: ink, blend: 'lighten' }]).png().toBuffer();
    }

    // Thicken the contours so there is room to color between them. Every step
    // above must stay lossless PNG: sharp re-encodes intermediates in the input
    // file's format by default, and JPEG ringing smears thresholded binary
    // output back into gray mush. The blur radius also sets stroke width, which
    // has to survive the reader downscaling a 1024px page to roughly half size.
    const thickened = await sharp(union).blur(1.8).threshold(55).png().toBuffer();
    const lineArt = await sharp(thickened).negate().png().toBuffer();

    return { base64: lineArt.toString('base64'), mimeType: 'image/png' };
  } catch (error) {
    console.error('[imageService] Line-art post-processing failed (non-fatal):', error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Persist a generated base64 image and register a media asset.
 */
async function persistAsset(params: {
  base64: string;
  mimeType: string;
  assetType: string;
  style: string;
  ownerId: string;
  bookId?: string;
  prompt: string;
}): Promise<GeneratedImageResult> {
  try {
    const { assetType, style, ownerId, bookId, prompt } = params;
    let { base64, mimeType } = params;

    // Guarantee line art for coloring pages / lineart styles.
    if (assetType === 'coloring_page' || LINE_ART_STYLES.has(style)) {
      const converted = await toLineArtBase64(base64, mimeType);
      if (converted) {
        base64 = converted.base64;
        mimeType = converted.mimeType;
      }
    }

    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
    const filename = generateFilename(`${assetType}_${style}`, ext);
    const publicUrl = await saveBase64File(
      assetType === 'cover' ? 'covers' : 'illustrations',
      filename,
      base64,
      { contentType: mimeType || 'image/png' }
    );
    const asset = await createMediaAsset({
      ownerId,
      bookId,
      assetType,
      storagePath: publicUrl,
      publicUrl,
      metadata: { style, prompt },
    });
    return { success: true, publicUrl, assetId: asset.id };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Backend 1: Google Gemini 2.5 Flash Image.
 * Returns base64 inside candidates[].content.parts[].inlineData.
 * Now with retry logic for quota limits (429 Too Many Requests).
 */
async function generateWithGemini(prompt: string, options: GenerateImageOptions): Promise<GeneratedImageResult> {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY as string);
    const modelName = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
    const model = genAI.getGenerativeModel({ model: modelName });

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const parts: any[] = result.response?.candidates?.[0]?.content?.parts || [];
        const imagePart: any = parts.find((p: any) => p.inlineData && p.inlineData.data);
        if (!imagePart || !imagePart.inlineData) {
          const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
          return { success: false, error: `Gemini returned no image. ${text ? 'Text: ' + text.slice(0, 200) : ''}` };
        }
        const data: string = imagePart.inlineData.data;
        const mimeType: string = imagePart.inlineData.mimeType;
        return persistAsset({
          base64: data,
          mimeType: mimeType || 'image/png',
          assetType: options.assetType,
          style: options.style || 'pixar',
          ownerId: options.ownerId,
          bookId: options.bookId,
          prompt,
        });
      } catch (error) {
        if (error instanceof Error && error.message.includes('429 Too Many Requests')) {
          if (attempt === maxRetries) {
            throw error;
          }
          console.warn(`[imageService] Gemini quota limit hit, retrying (attempt ${attempt}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
        } else {
          throw error;
        }
      }
    }
    return { success: false, error: 'Image generation failed after all retries' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Nearest canvas size the OpenRouter image models reliably accept, keeping the
 * requested orientation. Only used as a retry when the model rejects the size
 * we asked for.
 */
function normalizeOpenRouterSize(size: string): string {
  const supported = new Set(['1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792']);
  if (supported.has(size)) return size;
  const [w, h] = size.split('x').map((n) => parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return '1024x1024';
  const ratio = w / h;
  if (ratio > 1.05) return '1536x1024';
  if (ratio < 0.95) return '1024x1536';
  return '1024x1024';
}

/**
 * Backend: OpenRouter Images API (POST /api/v1/images).
 * First backup when Pollinations fails. Returns base64 in data[0].b64_json.
 * Model is env-tunable via OPENROUTER_IMAGE_MODEL.
 */
async function generateWithOpenRouter(prompt: string, options: GenerateImageOptions): Promise<GeneratedImageResult> {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY;
    if (!apiKey) {
      console.warn('[imageService] No OpenRouter API key configured for image generation');
      return { success: false, error: 'No OpenRouter API key configured' };
    }

    const model = process.env.OPENROUTER_IMAGE_MODEL || 'bytedance-seed/seedream-4.5';
    console.log(`[imageService] Attempting OpenRouter /api/v1/images with model ${model}`);

    const maxRetries = 3;
    // Seed identifies THIS picture (book + chapter + prompt), never the book
    // alone — a per-book seed made every chapter start from identical noise
    // and converge on the same subject. Retries shift the seed so a rejected
    // frame is not simply re-drawn.
    const baseSeed = deriveImageSeed(options.bookId ?? options.ownerId, options.assetType, options.seedSalt, prompt);
    // Recovery state for models that reject a field. This MUST live outside
    // the attempt loop: the body is rebuilt per attempt, so mutating the body
    // and `continue`-ing (the old code) silently re-added the rejected field
    // and burned every retry on the same failing request.
    let dropNegativePrompt = false;
    let sizeOverride: string | undefined;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const bodyPayload: Record<string, unknown> = {
        model,
        prompt,
        size: sizeOverride || options.size || '1024x1024',
        output_format: 'png',
        n: 1,
        seed: (baseSeed + (attempt - 1) * 7919) % 2147483647,
      };
      if (options.negativePrompt && !dropNegativePrompt) bodyPayload.negative_prompt = options.negativePrompt;
      try {
        console.log(`[imageService] OpenRouter attempt ${attempt}`);

        // Add timeout to prevent hanging - 60 seconds for image generation
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);

        const response = await fetch('https://openrouter.ai/api/v1/images', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`[imageService] OpenRouter response status: ${response.status}`);

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = `OpenRouter API error: ${response.status} ${response.statusText}` +
            (errorData.error?.message ? ` - ${errorData.error.message}` : '');
          console.error('[imageService] OpenRouter API error:', errorMsg);
          // Not every image model accepts a negative prompt. Drop the field and
          // retry the same request rather than failing the illustration. The
          // flag lives outside the loop because the body is rebuilt per attempt.
          if (!dropNegativePrompt && bodyPayload.negative_prompt && /negative|unknown|unrecognized|invalid/i.test(errorMsg)) {
            console.warn('[imageService] OpenRouter rejected negative_prompt — retrying without it');
            dropNegativePrompt = true;
            continue;
          }
          // Some models only accept a fixed set of canvas sizes; fall back to
          // the nearest supported one that keeps the same orientation.
          if (/size|resolution|aspect|dimension/i.test(errorMsg) && bodyPayload.size !== '1024x1024' && !sizeOverride) {
            const fallbackSize = normalizeOpenRouterSize(String(bodyPayload.size));
            console.warn(`[imageService] OpenRouter rejected size ${bodyPayload.size} — retrying with ${fallbackSize}`);
            sizeOverride = fallbackSize;
            continue;
          }
          throw new Error(errorMsg);
        }

        const data = await response.json();

        // Current Images API shape: data[0].b64_json (+ optional media_type).
        // Legacy shapes kept as fallback for older proxies.
        let base64Data: string | undefined;
        let mimeType: string = 'image/png';
        const first = Array.isArray(data.data) ? data.data[0] : undefined;
        if (first?.b64_json) {
          base64Data = first.b64_json;
          if (first.media_type) mimeType = first.media_type;
        } else if (first?.base64) {
          base64Data = first.base64;
        } else if (data.image) {
          base64Data = data.image;
        } else if (Array.isArray(data.images) && data.images[0]) {
          const img = data.images[0];
          base64Data = typeof img === 'string' ? img : img?.image_url?.url;
        }

        // Tolerate data-URI payloads (e.g. chat-style image_url.url responses).
        if (base64Data?.startsWith('data:')) {
          const comma = base64Data.indexOf(',');
          if (comma > 0) {
            const header = base64Data.slice(5, comma).split(';')[0];
            if (header.includes('/')) mimeType = header;
            base64Data = base64Data.slice(comma + 1);
          }
        }

        if (!base64Data) {
          console.error('[imageService] OpenRouter returned no image data');
          return { success: false, error: 'OpenRouter returned no image data' };
        }

        // A washed-out/greyscale frame means the style anchor was ignored.
        // Re-roll instead of shipping it as the chapter's illustration.
        if (!(await isFullColorUsable(Buffer.from(base64Data, 'base64'), options))) {
          console.warn(`[imageService] OpenRouter frame failed the colour gate (attempt ${attempt}/${maxRetries})`);
          if (attempt === maxRetries) {
            return { success: false, error: 'OpenRouter returned a washed-out image on every attempt' };
          }
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }

        console.log('[imageService] Image generation successful with OpenRouter');

        return persistAsset({
          base64: base64Data,
          mimeType: mimeType,
          assetType: options.assetType,
          style: options.style || 'pixar',
          ownerId: options.ownerId,
          bookId: options.bookId,
          prompt,
        });
      } catch (error) {
        // Handle the case where error is of type 'unknown' in strict TypeScript settings
        const err = error instanceof Error ? error : new Error(String(error));

        if (err.name === 'AbortError') {
          console.error('[imageService] OpenRouter request timed out');
          if (attempt === maxRetries) {
            return { success: false, error: 'OpenRouter request timed out' };
          }
        } else {
          console.error(`[imageService] OpenRouter attempt ${attempt} failed:`, err);
          if (attempt === maxRetries) {
            throw err;
          }
        }
        console.warn(`[imageService] OpenRouter failed (attempt ${attempt}/${maxRetries}):`, err.message);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    return { success: false, error: 'Image generation failed after all retries' };
  } catch (error) {
    console.error('[imageService] Unexpected error in generateWithOpenRouter:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Backend 2: Pollinations AI.
 * Fetches image from URL and converts to base64. Honors the requested size
 * and model, with a per-picture seed. Authenticated (gen.pollinations.ai)
 * when POLLINATIONS_API_KEY is set; legacy anonymous endpoint otherwise.
 */
function pollinationsSize(size: ImageSize): { width: number; height: number } {
  const [w, h] = size.split('x').map((n) => parseInt(n, 10));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { width: w, height: h };
  }
  return { width: 1024, height: 1024 };
}

/**
 * Fit a negative prompt into a URL query budget, keeping the earliest terms.
 *
 * Pollinations carries the prompt in the URL path; the full illustration
 * negative list adds ~600 encoded characters and pushes the request past
 * 2,200 characters, where CDN/proxy behaviour gets unreliable. The negative
 * lists are ordered most-important first (photograph, anime, flat 2D…), and
 * Flux largely ignores negatives anyway — so for URL transport we keep only
 * the leading terms instead of risking the whole request.
 */
function fitNegativeForUrl(negativeText: string, maxChars = 160): string {
  if (negativeText.length <= maxChars) return negativeText;
  const kept: string[] = [];
  let length = 0;
  for (const term of negativeText.split(', ')) {
    if (length + term.length + 2 > maxChars) break;
    kept.push(term);
    length += term.length + 2;
  }
  return kept.join(', ');
}

async function fetchWithTimeout(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Pollinations request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithPollinations(prompt: string, size: ImageSize, options: GenerateImageOptions): Promise<GeneratedImageResult> {
  // Pollinations uses URL-encoded prompts
  const encodedPrompt = encodeURIComponent(prompt);
  // Only coloring pages / line-art styles get the line-art extraction +
  // coloring-page quality gate below. Full-color assets (children's book
  // illustrations, covers) must skip both: the extractor would strip the
  // color, and the "colorable page" density gate rejects virtually every
  // full-color image — silently producing text-only books.
  const needsLineArt = options.assetType === 'coloring_page' || LINE_ART_STYLES.has(options.style || '');
  const { width, height } = pollinationsSize(size);
  const model = process.env.POLLINATIONS_MODEL || 'flux';
  // Pollinations ignores "no color" / "no photo" instructions inside the
  // positive prompt, so the negative prompt has to be passed explicitly:
  // line art is pushed away from color, full-color illustrations are pushed
  // away from every look that competes with the style anchor (photos, anime,
  // 2D cartoons, painted illustration, stray lettering).
  const negativeText = fitNegativeForUrl(
    options.negativePrompt || buildNegativePrompt(options.style || 'pixar', options.assetType)
  );
  const negative = negativeText
    ? `&negative_prompt=${encodeURIComponent(negativeText)}`
    : '';

  // Authenticated requests go to the unified gen.pollinations.ai API with the
  // account key as a Bearer header, spending the account's Pollen balance:
  // full model access, no anonymous throttling, watermark removal honoured.
  // The old code only checked that a key EXISTED and then called the legacy
  // endpoint anonymously — the paid balance was never used and every request
  // ran on the throttled anonymous tier. Without a key we keep the legacy
  // endpoint as the historical anonymous last resort.
  const apiKey = process.env.POLLINATIONS_API_KEY?.trim();
  const endpointBase = apiKey
    ? 'https://gen.pollinations.ai/image'
    : 'https://image.pollinations.ai/prompt';
  const authHeaders = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
  console.log(
    `[imageService] Pollinations via ${apiKey ? 'gen.pollinations.ai (authenticated)' : 'image.pollinations.ai (anonymous legacy)'} model=${model}`
  );

  const maxRetries = 4;
  // Per-picture seed (book + chapter + prompt) — a per-book seed made every
  // chapter converge on the same subject.
  const baseSeed = deriveImageSeed(options.bookId ?? options.ownerId, options.assetType, options.seedSalt, prompt);
  let lastError = '';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Vary the seed per attempt: Pollinations occasionally returns a flat,
    // degenerate image for line-art prompts, and a fresh seed nearly always
    // yields a usable one.
    const seed = (baseSeed + attempt * 7919) % 2147483647;
    const pollinationsUrl = `${endpointBase}/${encodedPrompt}?width=${width}&height=${height}&model=${model}&seed=${seed}&nologo=true${negative}`;
    try {
      const response = await fetchWithTimeout(pollinationsUrl, 60_000, authHeaders);
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (/insufficient balance|insufficient_balance|top up|pollen/i.test(body)) {
          // Account has zero Pollen — no seed retry can succeed; stop burning time.
          return { success: false, error: 'Pollinations account has no balance (Insufficient balance). Top up at enter.pollinations.ai or fund another image backend.' };
        }
        throw new Error(`Pollinations API error: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      // Guard against Pollinations returning a non-image (e.g. an error page).
      if (!contentType.includes('image')) {
        const body = await response.text().catch(() => '');
        if (/insufficient balance|insufficient_balance|top up|pollen/i.test(body)) {
          return { success: false, error: 'Pollinations account has no balance (Insufficient balance). Top up at enter.pollinations.ai or fund another image backend.' };
        }
        throw new Error(`Pollinations returned non-image content-type: ${contentType}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Reject flat washes outright — nothing to extract.
      if (await isDegenerateImage(buffer)) {
        lastError = `Pollinations returned a flat image (attempt ${attempt}/${maxRetries})`;
        console.warn(`[imageService] ${lastError}; retrying with a new seed...`);
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }

      // A full-colour page that comes back grey/washed out is a style
      // failure, not artwork — re-roll the seed instead of shipping it.
      if (!(await isFullColorUsable(buffer, options))) {
        lastError = `Pollinations returned a washed-out image (attempt ${attempt}/${maxRetries})`;
        console.warn(`[imageService] ${lastError}; retrying with a new seed...`);
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }

      const base64 = buffer.toString('base64');

      // Coloring pages: convert to line art (or keep if already clean) and
      // verify the result actually looks like a coloring page before
      // persisting. Anything faint, blank or banded needs a fresh seed.
      // Full-color illustrations/covers persist untouched.
      let finalBase64 = base64;
      let finalMime = contentType;
      if (needsLineArt) {
        const converted = await toLineArtBase64(base64, contentType);
        finalBase64 = converted ? converted.base64 : base64;
        finalMime = converted ? converted.mimeType : contentType;
        if (!(await isLineArtUsable(Buffer.from(finalBase64, 'base64')))) {
          lastError = `Pollinations image failed the quality gate (attempt ${attempt}/${maxRetries})`;
          console.warn(`[imageService] ${lastError}; retrying with a new seed...`);
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
      }
      return persistAsset({
        base64: finalBase64,
        mimeType: finalMime,
        assetType: options.assetType,
        style: options.style || 'pixar',
        ownerId: options.ownerId,
        bookId: options.bookId,
        prompt,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === maxRetries) {
        return { success: false, error: lastError };
      }
      console.warn(`[imageService] Pollinations failed (attempt ${attempt}/${maxRetries}):`, lastError);
      await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
  }

  return { success: false, error: `Pollinations generation failed after ${maxRetries} attempts: ${lastError}` };
}

/**
 * Backend 3: Pruna AI (P-Image). Cheap (~$0.005/image), ~1s latency, and the
 * only image backend with a funded balance since Pollinations went paid-anon-
 * disabled and Stability ran out of credits. Submit + optional status poll,
 * download the delivery URL, then run the same conversion + quality gate as
 * the Pollinations path.
 */
function prunaAspectRatio(size: ImageSize): string {
  const [w, h] = size.split('x').map((n) => parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return '1:1';
  if (w === h) return '1:1';
  const ratio = w / h;
  if (ratio >= 1.55) return '16:9';
  if (ratio >= 1.15) return '4:3';
  if (ratio <= 0.5) return '9:16';
  if (ratio <= 0.87) return '3:4';
  return '1:1';
}

async function pollPrunaStatus(statusUrl: string, apiKey: string): Promise<string | undefined> {
  for (let i = 0; i < 45; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      const response = await fetch(statusUrl, { headers: { apikey: apiKey }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) continue;
      const data = (await response.json()) as { generation_url?: string; output_url?: string; status?: string };
      if (data.generation_url) return data.generation_url;
      if (data.output_url) return data.output_url;
      if (data.status === 'failed' || data.status === 'cancelled') return undefined;
    } catch {
      // transient poll error — keep polling
    }
  }
  return undefined;
}

async function generateWithPruna(prompt: string, size: ImageSize, options: GenerateImageOptions): Promise<GeneratedImageResult> {
  const apiKey = process.env.PRUNA_AI_API_KEY;
  if (!apiKey) return { success: false, error: 'No Pruna API key configured' };

  const aspect_ratio = prunaAspectRatio(size);
  // Per-picture seed (book + chapter + prompt) — never per-book alone.
  const baseSeed = deriveImageSeed(options.bookId ?? options.ownerId, options.assetType, options.seedSalt, prompt);
  // Bounded retries: this backend sits in a fallback chain that blocks the
  // book's chapter pipeline, so it must fail fast rather than stall it.
  const maxRetries = 3;
  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const seed = (baseSeed + attempt * 7919) % 2147483647;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let submission: Record<string, unknown>;
      try {
        const response = await fetch('https://api.pruna.ai/v1/predictions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': apiKey,
            'Model': 'p-image',
            'Try-Sync': 'true',
          },
          body: JSON.stringify({ input: { prompt, aspect_ratio, seed } }),
          signal: controller.signal,
        });
        if (!response.ok) {
          let detail = '';
          try {
            const err = (await response.json()) as { message?: string };
            detail = err?.message || JSON.stringify(err);
          } catch { /* non-JSON error body */ }
          throw new Error(`Pruna API error: ${response.status} ${detail}`.trim());
        }
        submission = (await response.json()) as Record<string, unknown>;
      } finally {
        clearTimeout(timer);
      }

      // Try-Sync usually resolves inline; async submissions carry get_url.
      let imageUrl = (submission.generation_url || submission.output_url) as string | undefined;
      if (!imageUrl && typeof submission.get_url === 'string') {
        imageUrl = await pollPrunaStatus(submission.get_url, apiKey);
      }
      if (!imageUrl) {
        throw new Error(`Pruna returned no image URL: ${JSON.stringify(submission).slice(0, 200)}`);
      }

      const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
      if (!imageResponse.ok) throw new Error(`Pruna image download failed: ${imageResponse.status}`);
      const buffer = Buffer.from(await imageResponse.arrayBuffer());

      if (await isDegenerateImage(buffer)) {
        lastError = `Pruna returned a flat image (attempt ${attempt}/${maxRetries})`;
        console.warn(`[imageService] ${lastError}; retrying with a new seed...`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const contentType = imageResponse.headers.get('content-type') || (imageUrl.includes('.png') ? 'image/png' : 'image/jpeg');
      const base64 = buffer.toString('base64');

      // Only coloring pages / line-art styles get the line-art conversion and
      // the coloring-page density gate. Applying them to a full-colour
      // illustration stripped every illustration to an outline and then
      // rejected it — which is why this backend was never in the chain.
      const needsLineArt = options.assetType === 'coloring_page' || LINE_ART_STYLES.has(options.style || '');
      let finalBase64 = base64;
      let finalMime = contentType;
      if (needsLineArt) {
        const converted = await toLineArtBase64(base64, contentType);
        finalBase64 = converted ? converted.base64 : base64;
        finalMime = converted ? converted.mimeType : contentType;
        if (!(await isLineArtUsable(Buffer.from(finalBase64, 'base64')))) {
          console.warn(`[gate-debug] attempt ${attempt}: converted=${!!converted} mime=${finalMime} len=${finalBase64.length}`);
          lastError = `Pruna image failed the quality gate (attempt ${attempt}/${maxRetries})`;
          console.warn(`[imageService] ${lastError}; retrying with a new seed...`);
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
      } else if (!(await isFullColorUsable(buffer, options))) {
        lastError = `Pruna returned a washed-out image (attempt ${attempt}/${maxRetries})`;
        console.warn(`[imageService] ${lastError}; retrying with a new seed...`);
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      return persistAsset({
        base64: finalBase64,
        mimeType: finalMime,
        assetType: options.assetType,
        style: options.style || 'pixar',
        ownerId: options.ownerId,
        bookId: options.bookId,
        prompt,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === maxRetries) break;
      console.warn(`[imageService] Pruna failed (attempt ${attempt}/${maxRetries}): ${lastError}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return { success: false, error: `Pruna generation failed after ${maxRetries} attempts: ${lastError}` };
}

/**
 * Backend 3: Stability AI (stable-image / core).
 * Uses a per-picture seed and honors the requested aspect ratio. Returns JSON with a base64 `image` payload.
 */
function stabilityAspectRatio(size: ImageSize): string {
  const [w, h] = size.split('x').map((n) => parseInt(n, 10));
  if (!Number.isFinite(w) || !Number.isFinite(h) || h <= 0) return '1:1';
  if (w === h) return '1:1';
  const ratio = w / h;
  if (ratio >= 1.7) return '16:9';
  if (ratio >= 1.3) return '3:2';
  if (ratio >= 1.05) return '4:5';
  if (ratio <= 0.58) return '9:16';
  if (ratio <= 0.75) return '2:3';
  return '4:5';
}

async function generateWithStability(prompt: string, size: ImageSize, options: GenerateImageOptions): Promise<GeneratedImageResult> {
  const apiKey = process.env.STABILITY_AI_API_KEY;
  if (!apiKey) return { success: false, error: 'No Stability API key configured' };

  const aspectRatio = stabilityAspectRatio(size);
  // Per-picture seed (book + chapter + prompt). The old per-book seed was
  // also fixed across retries, so Stability literally re-drew the identical
  // image for every chapter and every retry.
  const baseSeed = deriveImageSeed(options.bookId ?? options.ownerId, options.assetType, options.seedSalt, prompt);

  // Negative prompt: line art is pushed away from color, full-colour art is
  // pushed away from every look that competes with the style anchor (photos,
  // anime, 2D cartoons, painted illustration, stray lettering).
  const negativeText = options.negativePrompt || buildNegativePrompt(options.style || 'pixar', options.assetType);

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Form is built per attempt so the seed can shift between retries.
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('aspect_ratio', aspectRatio);
    form.append('output_format', 'png');
    form.append('seed', String((baseSeed + (attempt - 1) * 7919) % 2147483647));
    if (negativeText) {
      form.append('negative_prompt', negativeText);
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let response: Response;
      try {
        response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': 'application/json',
          },
          body: form,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        let detail = '';
        try {
          const err: any = await response.json();
          detail = err?.message || (Array.isArray(err?.errors) ? err.errors.join(', ') : '') || '';
        } catch {}
        if (response.status === 402) {
          // Out of credits — retrying with the same key can never succeed.
          return { success: false, error: `Stability API error: 402 ${detail}`.trim() };
        }
        throw new Error(`Stability API error: ${response.status} ${detail}`.trim());
      }

      const data = (await response.json()) as { image?: string };
      if (!data?.image) {
        throw new Error('Stability returned no image data');
      }

      return persistAsset({
        base64: data.image,
        mimeType: 'image/png',
        assetType: options.assetType,
        style: options.style || 'pixar',
        ownerId: options.ownerId,
        bookId: options.bookId,
        prompt,
      });
    } catch (error) {
      if (attempt === maxRetries) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
      console.warn(`[imageService] Stability failed (attempt ${attempt}/${maxRetries}):`, error instanceof Error ? error.message : String(error));
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }

  return { success: false, error: `Stability generation failed after ${maxRetries} attempts` };
}

function isBackendConfigured(backend: ImageBackend): boolean {
  switch (backend) {
    case 'pollinations':
      return !!process.env.POLLINATIONS_API_KEY;
    case 'openrouter':
      return !!(process.env.OPENROUTER_API_KEY || process.env.OPEN_ROUTER_API_KEY);
    case 'stability':
      return !!process.env.STABILITY_AI_API_KEY;
    case 'pruna':
      return !!process.env.PRUNA_AI_API_KEY;
    default:
      return false;
  }
}

/**
 * Generate an image using the available backends with prioritized fallbacks.
 *
 * The prompt is composed as: short style tag → scene → full style vocabulary,
 * and a matching negative prompt is passed to every backend that supports one.
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImageResult> {
  const { prompt, style = 'pixar', size = '1024x1024', ownerId, bookId, assetType } = options;

  // Style FIRST and style LAST: image models weight the head of a prompt most
  // heavily, but the tail is what they read last — repeating the anchor on
  // both ends is what stops the scene description from washing the look out.
  const enhancedPrompt = composeImagePrompt(style, prompt);
  const negativePrompt = options.negativePrompt || buildNegativePrompt(style, assetType);
  const backendOptions: GenerateImageOptions = { ...options, prompt: enhancedPrompt, negativePrompt };

  console.log(
    `[imageService] generateImage called with: style=${style}, assetType=${assetType}, bookId=${bookId}`
  );

  const order = resolveBackendOrder(style, assetType);
  const configured = order.filter(isBackendConfigured);
  // Pollinations still serves some accounts without a key. Keep it as a last
  // resort in that case (historical behaviour), but never before a backend
  // that is actually funded.
  const anonymousFallback = order.filter((b) => b === 'pollinations' && !isBackendConfigured(b));
  const attemptOrder = [...configured, ...anonymousFallback];

  if (attemptOrder.length === 0) {
    return {
      success: false,
      error:
        'No image backend is configured. Set one of POLLINATIONS_API_KEY, OPENROUTER_API_KEY, STABILITY_AI_API_KEY or PRUNA_AI_API_KEY.',
    };
  }
  console.log(`[imageService] Backend order: ${attemptOrder.map((b) => BACKEND_LABELS[b]).join(' → ')}`);

  for (const backend of attemptOrder) {
    console.log(`[imageService] Trying ${BACKEND_LABELS[backend]}`);
    try {
      let result: GeneratedImageResult;
      switch (backend) {
        case 'pollinations':
          result = await generateWithPollinations(enhancedPrompt, size, backendOptions);
          break;
        case 'openrouter':
          result = await generateWithOpenRouter(enhancedPrompt, backendOptions);
          break;
        case 'stability':
          result = await generateWithStability(enhancedPrompt, size, backendOptions);
          break;
        case 'pruna':
          result = await generateWithPruna(enhancedPrompt, size, backendOptions);
          break;
      }
      if (result.success) {
        console.log(`[imageService] ${BACKEND_LABELS[backend]} produced the image`);
        // Hand back the exact prompt so the caller can store it on the
        // chapter — "what did the artist actually get?" must be answerable.
        return { ...result, prompt: enhancedPrompt };
      }
      console.error(`[imageService] ${BACKEND_LABELS[backend]} image generation failed:`, result.error);
    } catch (error) {
      console.error(`[imageService] ${BACKEND_LABELS[backend]} image generation failed with error:`, error);
    }
  }

  // If we get here, all configured backends failed
  return {
    success: false,
    error: 'All image backends failed. Please check API keys and account balances.'
  };
}

/**
 * Generate a book cover based on genre, audience, and theme.
 *
 * For children's books the cover is built from the book itself — the frozen
 * character sheet (the real cast in their canonical looks) plus the book's
 * own description — never the old genre-only template, which named nobody
 * and so put invented stranger children on every cover.
 */
export async function generateBookCover(bookId: string, ownerId: string, bookTitle: string, genre: string, targetAudience: string, coloringTheme?: string | null, coverContext?: { sheet?: CharacterSheet; description?: string | null }): Promise<GeneratedImageResult> {
  const isChildrenBook = ['0-5', '6-9', '10-14'].includes(targetAudience);
  const isColoringBook = genre === 'coloring';
  const style = isColoringBook
    ? (isChildrenBook ? 'lineart' : 'lineart-adult')
    : 'pixar';

  let coverPrompt: string;
  if (isColoringBook && coloringTheme && COLORING_THEMES[coloringTheme as ColoringTheme]) {
    const themeConfig = COLORING_THEMES[coloringTheme as ColoringTheme];
    coverPrompt = `${themeConfig.coverPrompt}. Book title: "${bookTitle}". Pure black and white line art, no shading.`;
  } else if (isChildrenBook) {
    coverPrompt = buildChildrenCoverScene(bookTitle, genre, coverContext?.sheet, coverContext?.description);
  } else {
    const premise = (coverContext?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
    coverPrompt = premise
      ? `Professional book cover for "${bookTitle}". ${premise} Cinematic, elegant, no text.`
      : `Professional book cover for "${bookTitle}". ${genre} genre. Cinematic, elegant, no text.`;
  }

  return generateImage({ prompt: coverPrompt, style, size: '1344x768', ownerId, bookId, assetType: 'cover', seedSalt: 'cover' });
}

/**
 * Generate a chapter illustration with character consistency support.
 */
export async function generateChapterIllustration(bookId: string, ownerId: string, chapterIndex: number, illustrationPrompt: string, style: string = 'pixar', sheet?: CharacterSheet): Promise<GeneratedImageResult> {
  // Character Consistency Logic: anchor recurring characters to their frozen
  // character-sheet looks so the cast doesn't redraw itself between chapters.
  //
  // The previous approach appended a bare cast list ("Recurring characters
  // in this series: Victoria, Biscuit — keep them consistent…"). That backfired
  // twice over: models read a repeated name as a SECOND character to draw
  // (two dogs, bonus children), and a name with no appearance words anchors
  // nothing. The sheet approach puts the consistency inside the scene
  // instead: every named character carries their canonical descriptor as an
  // appositive at first mention, and an exact-count clause states the census
  // ("exactly one girl and exactly one puppy…") plus which being owns the
  // fur, ears and tail. Anchoring here — at the last moment before the
  // backend call — also rescues heuristic fallback briefs, which quote raw
  // chapter sentences with bare names and no appearance words at all.
  let finalPrompt = illustrationPrompt;
  if (sheet && sheet.length > 0) {
    finalPrompt = anchorSceneWithSheet(finalPrompt, sheet);
    const countClause = buildExactCountClause(finalPrompt, sheet);
    if (countClause) {
      finalPrompt = `${finalPrompt} ${countClause}`;
    }
  }

  // For children's books, ensure we're generating full-color illustrations
  // that can be paired with text on 50% of the page
  const effectiveStyle = style;

  return generateImage({ prompt: finalPrompt, style: effectiveStyle, size: '1344x768', ownerId, bookId, assetType: 'illustration', seedSalt: `chapter-${chapterIndex}` });
}

/**
 * Strip color and lighting vocabulary from a scene description.
 *
 * The subject briefs the outline writer produces are written as prose — "golden
 * shafts", "silvery fish", "gradient sky", "long shadows". Image models weight
 * that content far more heavily than a list of negations appended after it, so
 * a coloring page prompt that keeps the color words reliably comes back as a
 * painted scene instead of line art. Removing the color words from the content
 * itself is what actually flips the backend into outline mode.
 */
function scrubColorWords(subject: string): string {
  return subject
    .replace(
      /\b(golden|gold|silver|silvery|bronze|copper|blue|azure|navy|teal|turquoise|cyan|green|emerald|olive|red|crimson|scarlet|maroon|pink|rose|magenta|purple|violet|indigo|orange|amber|peach|yellow|brown|tan|beige|cream|grey|gray|white|black|colourful|colorful|vivid|vibrant|bright|dark|dusky|glowing|glow|luminous|shimmering|sparkling|iridescent|rainbow|gradient|gradients|sunset|sunrise|sunlit|dusk|dawn|twilight|halo|light|lighting|shadow|shadows|soft|hazy|misty|atmospheric|tranquil|serene)\b/gi,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/,\s*,/g, ',')
    .replace(/([,;:])\s*\1+/g, '$1')
    .replace(/[,:;]\s*$/, '')
    .trim();
}

/**
 * Generate a coloring page with appropriate style for children or adults.
 */
export async function generateColoringPage(bookId: string, ownerId: string, chapterIndex: number, subject: string, theme?: ColoringTheme | null, targetAudience?: TargetAudience): Promise<GeneratedImageResult> {
  const isAdultTheme = !!theme;
  const isKidsBook = targetAudience ? ['0-5', '6-9', '10-14'].includes(targetAudience) : false;
  const subjectText = scrubColorWords(subject);

  // One short, coherent instruction set. Long stacks of "no X, no Y" repeated
  // by both this prompt and STYLE_CONFIG diluted the line-art direction and let
  // the scene description dominate. The theme's own pagePromptPrefix is dropped
  // for the same reason: it carries more color vocabulary than the subject does.
  const artDirection = isAdultTheme
    ? 'Draw the subject as intricate black contour line art: fine, even line weight, ornamental detail, and white space inside every shape so it can be colored in.'
    : isKidsBook
      ? 'Draw the subject as simple bold black outline art: thick even lines, basic shapes, and large open white areas so a child can color them in.'
      : 'Draw the subject as intricate black contour line art: fine, even line weight, ornamental detail, and white space inside every shape so it can be colored in.';

  const ageDescriptor = isKidsBook ? 'Children\'s' : 'Adult';
  const prompt = `${ageDescriptor} coloring book page, black outline drawing on a pure white background. Subject: ${subjectText}. ${artDirection} Outlines only: no color, no shading, no gradients, no filled areas, no background texture.`;

  return generateImage({
    prompt,
    style: isAdultTheme ? 'lineart-adult' : 'lineart',
    size: '1024x1024',
    ownerId,
    bookId,
    assetType: 'coloring_page',
    seedSalt: `chapter-${chapterIndex}`,
  });
}