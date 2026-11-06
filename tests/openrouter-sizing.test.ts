// Tests for the OpenRouter Images sizing helpers.
//
// The production failure these guard: IMAGE_BACKEND_ORDER put OpenRouter
// first, but Seedream 4.5 rejected every request — "requires at least
// 3,686,400 output pixels; size 1536x1024 is 1,572,864" — so Pollinations
// silently generated every illustration. Sizing now goes through the
// unified aspect_ratio + resolution parameters, and directional size
// rejections walk the resolution tier instead of failing identically.

import {
  classifySizeError,
  nearestAspectRatio,
  parseAcceptedTierIndex,
  parseMinimumPixels,
  tierIndexForResolution,
  RESOLUTION_TIERS,
} from '@/lib/services/openRouterSizing';

describe('nearestAspectRatio', () => {
  it('maps the app canvases onto unified ratios', () => {
    expect(nearestAspectRatio(1344, 768)).toBe('16:9'); // chapter illustrations + covers
    expect(nearestAspectRatio(1024, 1024)).toBe('1:1'); // colouring pages
    expect(nearestAspectRatio(768, 1344)).toBe('9:16');
    expect(nearestAspectRatio(864, 1152)).toBe('3:4');
    expect(nearestAspectRatio(1152, 864)).toBe('4:3');
  });

  it('falls back to 1:1 for degenerate dimensions', () => {
    expect(nearestAspectRatio(0, 768)).toBe('1:1');
    expect(nearestAspectRatio(NaN, 768)).toBe('1:1');
    expect(nearestAspectRatio(1024, -1)).toBe('1:1');
  });
});

describe('parseMinimumPixels + classifySizeError', () => {
  const seedreamRejection =
    'OpenRouter API error: 400 Bad Request - bytedance-seed/seedream-4.5 requires at least 3,686,400 output pixels; size "1536x1024" is 1,572,864. Use a larger size such as "2048x2048", or omit size to use the default.';

  it('reads the verbatim production Seedream rejection', () => {
    expect(parseMinimumPixels(seedreamRejection)).toBe(3686400);
    expect(classifySizeError(seedreamRejection)).toBe('too-small');
  });

  it('classifies pixel ceilings as too-large', () => {
    expect(classifySizeError('size exceeds the maximum of 2,097,152 pixels')).toBe('too-large');
    expect(classifySizeError('Image too large; use a smaller size')).toBe('too-large');
  });

  it('leaves non-directional errors to the strip-level ladder', () => {
    // A model rejecting the resolution *parameter* must drop optional fields
    // (strip ladder), not walk tiers — so these classify as null.
    expect(classifySizeError('Unsupported parameter: resolution')).toBeNull();
    expect(classifySizeError('Invalid API key')).toBeNull();
    expect(parseMinimumPixels('Invalid API key')).toBeNull();
  });

  it('reads "resolution not supported" as a tier ceiling', () => {
    // The flash-lite-image 400 from production: the model rejects the 2K
    // tier, not the parameter — step down instead of stripping fields.
    expect(
      classifySizeError('Parameters invalid: parameters.resolution must be valid resolution option: not supported. Accepted: 1K')
    ).toBe('too-large');
    expect(classifySizeError('resolution not supported for this model')).toBe('too-large');
    // ...but an "unsupported parameter" rejection still goes to the strip ladder:
    expect(classifySizeError('Unsupported parameter: resolution')).toBeNull();
  });
});

describe('parseAcceptedTierIndex', () => {
  it('reads the provider-named tier (the flash-lite-image rejection)', () => {
    expect(
      RESOLUTION_TIERS[parseAcceptedTierIndex('parameters.resolution must be valid resolution option: not supported. Accepted: 1K') ?? -1]
    ).toBe('1K');
    expect(RESOLUTION_TIERS[parseAcceptedTierIndex('Resolution not supported. Supported resolutions: 512, 1K, 2K') ?? -1]).toBe('2K');
    expect(RESOLUTION_TIERS[parseAcceptedTierIndex('valid values are 1K and 2K') ?? -1]).toBe('2K');
  });

  it('stays out of the way when no resolutions are named', () => {
    expect(parseAcceptedTierIndex('Unsupported parameter: resolution')).toBeNull();
    expect(parseAcceptedTierIndex('Invalid API key')).toBeNull();
  });

  it('does not undercut a pixel floor (Seedream)', () => {
    const floor = 'requires at least 3,686,400 output pixels; use a larger size such as "2048x2048"';
    expect(parseAcceptedTierIndex(floor)).toBeNull();
  });
});

describe('tierIndexForResolution', () => {
  it('defaults to 2K (clears the Seedream floor) and honours valid pins', () => {
    expect(RESOLUTION_TIERS[tierIndexForResolution(undefined)]).toBe('2K');
    expect(RESOLUTION_TIERS[tierIndexForResolution('')]).toBe('2K');
    expect(RESOLUTION_TIERS[tierIndexForResolution('1K')]).toBe('1K');
    expect(RESOLUTION_TIERS[tierIndexForResolution('4k')]).toBe('4K');
    expect(RESOLUTION_TIERS[tierIndexForResolution('bogus')]).toBe('2K');
  });
});
