// Tests for the image prompt composition helpers.
//
// These are the levers behind "the art is not really Pixar and does not match
// the page": the style anchor has to survive the scene description, the
// negative prompt has to name the competing looks, and the backend order has
// to be overridable without a code change.

import {
  buildNegativePrompt,
  composeImagePrompt,
  deriveImageSeed,
  resolveBackendOrder,
  ILLUSTRATION_NEGATIVE_PROMPT,
  LINE_ART_NEGATIVE_PROMPT,
  BACKEND_LABELS,
  type ImageBackend,
} from '@/lib/services/imagePrompts';
import { STYLE_CONFIG } from '@/types';

describe('composeImagePrompt', () => {
  it('leads with the style anchor and closes with it again', () => {
    const scene = 'Maya climbs the old oak tree and drops the red kite into the branches.';
    const prompt = composeImagePrompt('pixar', scene);

    expect(prompt.startsWith(STYLE_CONFIG.pixar.prompt)).toBe(true);
    expect(prompt).toContain(scene);
    expect(prompt.trim().endsWith(STYLE_CONFIG.pixar.tail!.trim())).toBe(true);
  });

  it('keeps the scene between the two style anchors', () => {
    const scene = 'A fox dashes across the snowy field toward the lantern light.';
    const prompt = composeImagePrompt('pixar', scene);
    const headIndex = prompt.indexOf(STYLE_CONFIG.pixar.prompt);
    const sceneIndex = prompt.indexOf(scene);
    const tailIndex = prompt.indexOf(STYLE_CONFIG.pixar.tail!.trim());

    expect(headIndex).toBeLessThan(sceneIndex);
    expect(sceneIndex).toBeLessThan(tailIndex);
  });

  it('puts the scene inside the early encoder window, not after a style essay', () => {
    // CLIP-based encoders (Flux, SD3) only read roughly the first 77 tokens
    // (~300 chars). The regression this guards: a 401-char style head pushed
    // the scene to char 403, so the model drew the style words' default
    // subject on every page. The scene's first words must land early.
    const scene = 'Victoria, a girl in yellow overalls and red boots, races Biscuit, a fluffy brown puppy, across a wildflower meadow.';
    const prompt = composeImagePrompt('pixar', scene);
    expect(prompt.indexOf('Victoria')).toBeLessThan(120);
    expect(prompt.slice(0, 300)).toContain('Biscuit');
  });

  it('keeps the pixar head short enough that the subject leads', () => {
    expect(STYLE_CONFIG.pixar.prompt.length).toBeLessThan(80);
  });

  it('still carries the full pixar render vocabulary, at the tail', () => {
    const prompt = composeImagePrompt('pixar', 'Maya holds the red kite above her head.');
    expect(prompt).toContain('subsurface-scattering');
    expect(prompt).toContain('physically based render');
    expect(prompt).toContain('rounded appealing proportions');
    expect(prompt).toContain('No text, no lettering, no watermark');
    // …and all of it AFTER the scene, where it cannot evict the subject.
    expect(prompt.indexOf('Maya holds')).toBeLessThan(prompt.indexOf('subsurface-scattering'));
  });

  it('collapses whitespace so the scene stays a single readable block', () => {
    const prompt = composeImagePrompt('pixar', 'Maya   opens the\n\ngate   slowly.');
    expect(prompt).not.toContain('\n');
    expect(prompt).toContain('Maya opens the gate slowly.');
  });

  it('never produces a doubled full stop', () => {
    const prompt = composeImagePrompt('pixar', 'Maya holds the kite.');
    expect(prompt).not.toMatch(/\.\./);
    expect(prompt).not.toMatch(/\s\./);
  });

  it('falls back to the pixar style for an unknown style key', () => {
    const prompt = composeImagePrompt('not-a-style', 'A quiet street.');
    expect(prompt.startsWith(STYLE_CONFIG.pixar.prompt)).toBe(true);
  });

  it('does not append a colour tail to line art', () => {
    const prompt = composeImagePrompt('lineart', 'A lighthouse on a cliff.');
    expect(prompt).not.toContain('vibrant colors');
    expect(prompt.startsWith(STYLE_CONFIG.lineart.prompt)).toBe(true);
  });
});

describe('buildNegativePrompt', () => {
  it('names the looks that compete with the pixar style', () => {
    const negative = buildNegativePrompt('pixar', 'illustration');
    expect(negative).toBe(ILLUSTRATION_NEGATIVE_PROMPT);
    expect(negative).toMatch(/photograph/);
    expect(negative).toMatch(/anime/);
    expect(negative).toMatch(/2d cartoon/);
    expect(negative).toMatch(/text/);
    // Cast integrity: no second dog, no bonus sibling, no animal features
    // bleeding onto the human child.
    expect(negative).toMatch(/duplicate character/);
    expect(negative).toMatch(/twins/);
    expect(negative).toMatch(/extra child/);
    expect(negative).toMatch(/animal ears on human/);
  });

  it('pushes line art away from colour instead', () => {
    expect(buildNegativePrompt('lineart', 'coloring_page')).toBe(LINE_ART_NEGATIVE_PROMPT);
    expect(buildNegativePrompt('lineart-adult', 'illustration')).toBe(LINE_ART_NEGATIVE_PROMPT);
  });

  it('keeps photographic styles away from illustration', () => {
    const negative = buildNegativePrompt('realistic', 'illustration');
    expect(negative).toMatch(/illustration/);
    expect(negative).not.toBe(ILLUSTRATION_NEGATIVE_PROMPT);
  });

  it('gives the cover-designer presets their own negative prompt', () => {
    // A noir cover must not be pushed away from photography, and a noir frame
    // must not be pushed toward colour.
    const noir = buildNegativePrompt('noir', 'cover');
    expect(noir).not.toBe(ILLUSTRATION_NEGATIVE_PROMPT);
    expect(noir).toMatch(/color/);
    expect(noir).not.toMatch(/photograph/);

    const cyberpunk = buildNegativePrompt('cyberpunk', 'cover');
    expect(cyberpunk).toMatch(/black and white/);
  });
});

describe('deriveImageSeed', () => {
  it('is deterministic for identical inputs', () => {
    expect(deriveImageSeed('book1', 'illustration', 'chapter-0', 'Victoria races Biscuit'))
      .toBe(deriveImageSeed('book1', 'illustration', 'chapter-0', 'Victoria races Biscuit'));
  });

  it('differs between chapters of the same book (the per-book-seed regression)', () => {
    const ch1 = deriveImageSeed('book1', 'illustration', 'chapter-0', 'Victoria races Biscuit across the meadow');
    const ch2 = deriveImageSeed('book1', 'illustration', 'chapter-1', 'Victoria and Biscuit shelter from the rain in the barn');
    expect(ch1).not.toBe(ch2);
  });

  it('differs when the scene text changes for the same chapter', () => {
    const a = deriveImageSeed('book1', 'illustration', 'chapter-0', 'Victoria opens the gate');
    const b = deriveImageSeed('book1', 'illustration', 'chapter-0', 'Victoria climbs the oak tree');
    expect(a).not.toBe(b);
  });

  it('stays inside the backends seed range and tolerates missing parts', () => {
    const seed = deriveImageSeed('book1', 'illustration', undefined, 'a scene');
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2147483647);
  });
});

describe('resolveBackendOrder', () => {
  const original = process.env.IMAGE_BACKEND_ORDER;

  afterEach(() => {
    if (original === undefined) delete process.env.IMAGE_BACKEND_ORDER;
    else process.env.IMAGE_BACKEND_ORDER = original;
  });

  it('defaults to pollinations first and keeps every backend in the chain', () => {
    delete process.env.IMAGE_BACKEND_ORDER;
    const order = resolveBackendOrder('pixar', 'illustration');
    expect(order[0]).toBe('pollinations');
    expect(order).toEqual(expect.arrayContaining(['openrouter', 'stability', 'pruna']));
  });

  it('honours IMAGE_BACKEND_ORDER and still keeps unlisted backends as fallbacks', () => {
    process.env.IMAGE_BACKEND_ORDER = 'openrouter,pollinations';
    const order = resolveBackendOrder('pixar', 'illustration');
    expect(order[0]).toBe('openrouter');
    expect(order[1]).toBe('pollinations');
    expect(order).toContain('stability');
    expect(order).toContain('pruna');
  });

  it('ignores unknown backend names', () => {
    process.env.IMAGE_BACKEND_ORDER = 'openrouter,not-a-backend';
    const order = resolveBackendOrder('pixar', 'illustration');
    expect(order[0]).toBe('openrouter');
    expect(order.every((b: ImageBackend) => b in BACKEND_LABELS)).toBe(true);
  });

  it('de-duplicates repeated backends', () => {
    process.env.IMAGE_BACKEND_ORDER = 'pruna,pruna,openrouter';
    const order = resolveBackendOrder('pixar', 'illustration');
    expect(order.filter((b) => b === 'pruna')).toHaveLength(1);
  });
});
