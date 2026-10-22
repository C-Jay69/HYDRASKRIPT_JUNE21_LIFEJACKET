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
  findBriefContradiction,
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

  it('hands the brief writer the canonical character sheet', async () => {
    mockAskLLM.mockResolvedValue('Maya pulls the kite free from the oak tree branches.');
    const sheet = [
      { name: 'Maya', countNoun: 'girl', isAnimal: false, descriptor: 'a girl about eight with dark curly hair in a yellow raincoat' },
      { name: 'Biscuit', countNoun: 'puppy', isAnimal: true, descriptor: 'a small fluffy brown puppy with floppy ears' },
    ];

    await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9', sheet);

    const userPrompt = mockAskLLM.mock.calls[0][1];
    expect(userPrompt).toContain('CANONICAL CHARACTER SHEET');
    expect(userPrompt).toContain('Maya — a girl about eight with dark curly hair in a yellow raincoat');
    expect(userPrompt).toContain('Biscuit — a small fluffy brown puppy with floppy ears');
  });

  it('forbids the brief writer from re-inventing looks or adding characters', async () => {
    mockAskLLM.mockResolvedValue('Maya pulls the kite free from the oak tree branches.');

    await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9');

    const systemPrompt = mockAskLLM.mock.calls[0][0];
    expect(systemPrompt).toMatch(/WORD FOR WORD/i);
    expect(systemPrompt).toMatch(/exactly once/i);
    expect(systemPrompt).toMatch(/never give them animal ears/i);
  });

  it('tells the brief writer to state what every character is, not just their name', async () => {
    mockAskLLM.mockResolvedValue('Maya pulls the kite free from the oak tree branches.');

    await buildIllustrationBrief(CHAPTER, 'The Kite', '6-9');

    const systemPrompt = mockAskLLM.mock.calls[0][0];
    expect(systemPrompt).toMatch(/state plainly WHAT they are/i);
    expect(systemPrompt).toMatch(/wrong animal/i);
  });

  it('rejects a brief whose animal contradicts the chapter (the kitten regression)', async () => {
    const dogChapter = [
      'Victoria woke up before the roosters did and pulled on her yellow overalls and red boots.',
      'Waiting by the door, tail wagging like a windshield wiper, was Biscuit — the fluffiest, bounciest puppy on the whole farm.',
      'Biscuit barked, and away they raced across the golden meadow while butterflies danced above the wildflowers.',
    ].join(' ');
    mockAskLLM.mockResolvedValue(
      'A tiny kitten with huge eyes sits alone in a sunny meadow, batting at a butterfly with one small paw.'
    );

    const brief = await buildIllustrationBrief(dogChapter, 'The Great Meadow Race', '0-5', [
      { name: 'Victoria', countNoun: 'girl', isAnimal: false, descriptor: 'a girl about seven with curly red hair in yellow overalls and red boots' },
      { name: 'Biscuit', countNoun: 'puppy', isAnimal: true, descriptor: 'a fluffy brown puppy' },
    ]);

    expect(brief).not.toMatch(/kitten/i);
    expect(brief).toMatch(/Biscuit|puppy|Victoria/);
  });

  it('accepts a brief whose animal matches the chapter', async () => {
    const dogChapter =
      'Victoria raced Biscuit, her fluffy brown puppy, across the meadow. Biscuit barked at the butterflies and his ears flew backwards like little wings.';
    mockAskLLM.mockResolvedValue(
      'Victoria, a girl with curly red hair in yellow overalls and red boots, runs laughing beside Biscuit, a fluffy brown puppy, through a wildflower meadow.'
    );

    const brief = await buildIllustrationBrief(dogChapter, 'The Great Meadow Race', '0-5', [
      { name: 'Victoria', countNoun: 'girl', isAnimal: false, descriptor: 'a girl with curly red hair in yellow overalls and red boots' },
      { name: 'Biscuit', countNoun: 'puppy', isAnimal: true, descriptor: 'a fluffy brown puppy' },
    ]);

    expect(brief).toContain('fluffy brown puppy');
  });
});

describe('findBriefContradiction', () => {
  const dogChapter = 'Biscuit the puppy barked and wagged his tail as Victoria opened the farm gate.';

  it('flags a kitten brief for a dog chapter', () => {
    expect(findBriefContradiction('A small kitten plays in the grass.', dogChapter)).toMatch(/cat/);
  });

  it('flags it even when the chapter only shows dog behaviour, never the noun', () => {
    const behaviourOnly = 'Biscuit barked twice, wagging his tail so hard his whole body wiggled.';
    expect(findBriefContradiction('A kitten sits by the gate.', behaviourOnly)).not.toBeNull();
  });

  it('accepts a puppy brief for a dog chapter (same group)', () => {
    expect(findBriefContradiction('A fluffy puppy runs beside the girl.', dogChapter)).toBeNull();
  });

  it('accepts a kitten brief when the chapter is actually about a cat', () => {
    const catChapter = 'Marmalade the kitten purred and curled up on the warm porch.';
    expect(findBriefContradiction('A kitten sleeps on the porch.', catChapter)).toBeNull();
  });

  it('stays out of the way when the chapter offers no animal evidence either way', () => {
    const noAnimal = 'Victoria splashed through the puddles on the lane, laughing at her red boots.';
    expect(findBriefContradiction('A kitten watches from the fence.', noAnimal)).toBeNull();
  });

  it('ignores briefs with no animal in them', () => {
    expect(findBriefContradiction('Victoria opens the big red barn door at sunrise.', dogChapter)).toBeNull();
  });
});
