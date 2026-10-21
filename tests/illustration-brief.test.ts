// Tests for the illustration brief builder.
//
// The brief is what makes the artwork match the page. Two things broke that:
// the writer only saw the first 2,800 characters of a chapter (so the scene
// came from the wrong part of the story), and the fallback grabbed the first
// two sentences (the setup, not the moment worth drawing).

jest.mock('@/lib/llm/fallback', () => ({
  askLLMWithFallback: jest.fn(),
  askLLMJSONWithFallback: jest.fn(),
}));

import {
  splitSentences,
  scoreVisualSentence,
  pickVisualSentences,
  selectChapterExcerpt,
  sanitizeBrief,
  buildIllustrationBrief,
} from '@/lib/services/illustrationBrief';
import { askLLMWithFallback } from '@/lib/llm/fallback';

const mockAskLLM = askLLMWithFallback as jest.MockedFunction<typeof askLLMWithFallback>;

const CHAPTER = [
  'Maya had been waiting all morning for the storm to pass.',
  'She wanted to fly her kite, but the rain kept tapping on the window.',
  'Finally she jumped up, ran to the back door, and threw it into the wind.',
  'The red kite climbed over the fence and tangled in the branches of the old oak tree.',
  'Maya climbed the trunk, reached past the crows, and pulled it free.',
  'The kite soared again, bright against the grey sky, and Maya laughed out loud.',
].join(' ');

describe('splitSentences', () => {
  it('splits prose into sentences', () => {
    const sentences = splitSentences(CHAPTER);
    expect(sentences.length).toBeGreaterThanOrEqual(6);
    expect(sentences[0]).toContain('waiting all morning');
  });
});

describe('scoreVisualSentence', () => {
  it('scores a concrete action above interior narration', () => {
    const action = 'Maya climbed the trunk and pulled the kite free.';
    const interior = 'She wanted to fly her kite, but the rain kept tapping on the window.';
    expect(scoreVisualSentence(action)).toBeGreaterThan(scoreVisualSentence(interior));
  });
});

describe('pickVisualSentences', () => {
  it('does not fall back to the opening sentences when a better scene exists', () => {
    const picked = pickVisualSentences(CHAPTER, 2);
    expect(picked).toMatch(/kite|climbed|trunk|branches|crows|soared/);
    expect(picked).not.toBe(
      'Maya had been waiting all morning for the storm to pass. She wanted to fly her kite, but the rain kept tapping on the window.'
    );
  });

  it('keeps the chapter reading order', () => {
    const picked = pickVisualSentences(CHAPTER, 2);
    const first = picked.indexOf('jumped up');
    const later = picked.indexOf('soared');
    if (first !== -1 && later !== -1) {
      expect(first).toBeLessThan(later);
    }
  });

  it('returns something usable for an empty chapter', () => {
    expect(pickVisualSentences('', 2)).toBe('');
  });
});

describe('selectChapterExcerpt', () => {
  it('keeps a short chapter whole', () => {
    expect(selectChapterExcerpt(CHAPTER)).toBe(CHAPTER.trim());
  });

  it('keeps the ending of a long chapter, not just the head', () => {
    const long = `${CHAPTER} ${'Extra narration. '.repeat(400)}`;
    const excerpt = selectChapterExcerpt(long, 6000);
    expect(excerpt.length).toBeLessThanOrEqual(6200);
    expect(excerpt).toContain('Maya laughed out loud');
  });

  it('marks the cut so the writer knows content was skipped', () => {
    const long = `${CHAPTER} ${'Extra narration. '.repeat(400)}`;
    expect(selectChapterExcerpt(long, 2000)).toContain('[...]');
  });
});

describe('sanitizeBrief', () => {
  it('strips a preamble', () => {
    expect(sanitizeBrief('Here is the scene: Maya holds the kite.')).toBe('Maya holds the kite.');
  });

  it('removes artwork vocabulary so the brief describes the world, not the picture', () => {
    const cleaned = sanitizeBrief('A Pixar illustration of Maya in the rain.');
    expect(cleaned).not.toMatch(/illustration/i);
    expect(cleaned).not.toMatch(/pixar/i);
  });

  it('trims quotes and collapses whitespace', () => {
    expect(sanitizeBrief('  "Maya opens the gate."  ')).toBe('Maya opens the gate.');
  });
});

describe('buildIllustrationBrief', () => {
  beforeEach(() => {
    mockAskLLM.mockReset();
  });

  it('uses the scene the brief writer returned', async () => {
    mockAskLLM.mockResolvedValue(
      'Maya stands on a wet street holding the red kite above her head, wind pulling her curls, puddles reflecting the grey sky.'
    );

    const brief = await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9');

    expect(brief).toContain('red kite');
    expect(brief.length).toBeLessThanOrEqual(480);
  });

  it('gives the brief writer the whole chapter, not just its head', async () => {
    mockAskLLM.mockResolvedValue('Maya pulls the kite free from the oak tree branches.');

    await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9');

    const userPrompt = mockAskLLM.mock.calls[0][1];
    expect(userPrompt).toContain('Maya laughed out loud');
  });

  it('falls back to the most drawable beats when the LLM call fails', async () => {
    mockAskLLM.mockRejectedValue(new Error('provider unreachable'));

    const brief = await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9');

    expect(brief.length).toBeGreaterThan(0);
    expect(brief).toMatch(/kite|climbed|trunk|branches|soared/);
  });

  it('falls back when the LLM returns something too short to be a scene', async () => {
    mockAskLLM.mockResolvedValue('ok');

    const brief = await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9');

    expect(brief.length).toBeGreaterThan(0);
    expect(brief).toMatch(/kite|climbed|trunk|branches|soared/);
  });
});
