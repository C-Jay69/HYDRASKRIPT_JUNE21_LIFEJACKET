// Tests for the canonical character sheet.
//
// The failures this guards against, all seen in real output: the heroine
// redrawing herself between chapters (no frozen look anywhere), a SECOND
// dog / bonus child appearing (models reading a repeated cast list as more
// characters), a girl with a tail (animal features bleeding onto the human),
// and a front cover full of strangers (a genre-only cover template).

jest.mock('@/lib/llm/fallback', () => ({
  askLLMWithFallback: jest.fn(),
  askLLMJSONWithFallback: jest.fn(),
}));

import {
  anchorSceneWithSheet,
  applyCharacterSheetToScene,
  buildCharacterSheet,
  buildChildrenCoverScene,
  buildExactCountClause,
  censusParts,
  guessFallbackSheet,
  isCompleteSheet,
  normalizeDescriptor,
  parseCastEntry,
  parseCharacterSheet,
  parseSheetJson,
  presentInScene,
  serializeCharacterSheet,
  type CharacterSheet,
} from '@/lib/services/characterSheet';
import { askLLMWithFallback } from '@/lib/llm/fallback';

const mockAskLLM = askLLMWithFallback as jest.MockedFunction<typeof askLLMWithFallback>;

const Victoria = {
  name: 'Victoria',
  countNoun: 'girl',
  isAnimal: false,
  descriptor: 'a girl about seven years old with curly red hair, freckles, yellow overalls and red rain boots',
};
const BISCUIT = {
  name: 'Biscuit',
  countNoun: 'puppy',
  isAnimal: true,
  descriptor: 'a small fluffy brown puppy with floppy ears and a blue collar',
};
const DADA = {
  name: 'Dada',
  countNoun: 'father',
  isAnimal: false,
  descriptor: 'a tall father with a short black beard in a green flannel shirt',
};
const SHEET: CharacterSheet = [Victoria, BISCUIT, DADA];

describe('normalizeDescriptor', () => {
  it('adds a lowercase article and strips the trailing full stop', () => {
    expect(normalizeDescriptor('Girl with curly red hair.')).toBe('a girl with curly red hair');
    expect(normalizeDescriptor('A small fluffy puppy')).toBe('a small fluffy puppy');
    expect(normalizeDescriptor('  an old owl with spectacles  ')).toBe('an old owl with spectacles');
  });
});

describe('parseCharacterSheet / serializeCharacterSheet', () => {
  it('round-trips a stored sheet', () => {
    const parsed = parseCharacterSheet(serializeCharacterSheet(SHEET));
    expect(parsed).toHaveLength(3);
    expect(parsed[1]).toEqual(BISCUIT);
  });

  it('degrades to an empty sheet on garbage instead of throwing', () => {
    expect(parseCharacterSheet('not json')).toEqual([]);
    expect(parseCharacterSheet('{"nope":true}')).toEqual([]);
    expect(parseCharacterSheet(null)).toEqual([]);
    expect(parseCharacterSheet(undefined)).toEqual([]);
  });

  it('drops nameless and duplicate entries and normalises descriptors', () => {
    const parsed = parseCharacterSheet(JSON.stringify([
      { name: '', descriptor: 'a ghost' },
      { name: 'Victoria', countNoun: 'Young Girl', isAnimal: false, descriptor: 'Girl with red hair.' },
      { name: 'Victoria', countNoun: 'girl', isAnimal: false, descriptor: 'a duplicate entry' },
    ]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].countNoun).toBe('girl');
    expect(parsed[0].descriptor).toBe('a girl with red hair');
  });
});

describe('isCompleteSheet', () => {
  it('requires a real look on every entry before freezing', () => {
    expect(isCompleteSheet(SHEET)).toBe(true);
    expect(isCompleteSheet([{ name: 'Biscuit', countNoun: 'puppy', isAnimal: true, descriptor: 'a puppy' }])).toBe(false);
    expect(isCompleteSheet([])).toBe(false);
  });
});

describe('presentInScene', () => {
  it('finds only the characters the scene actually names', () => {
    const present = presentInScene('Victoria kneels beside Biscuit in the garden.', SHEET);
    expect(present.map((e) => e.name)).toEqual(['Victoria', 'Biscuit']);
  });

  it('does not match a name inside a longer word', () => {
    expect(presentInScene('The Mayan temple glows at dawn.', [{ name: 'Maya', countNoun: 'girl', isAnimal: false, descriptor: 'a girl' }])).toEqual([]);
  });
});

describe('anchorSceneWithSheet', () => {
  it('splices the frozen descriptor in at the first bare-name mention', () => {
    const scene = anchorSceneWithSheet('Victoria runs laughing across the golden meadow with Biscuit at her heels.', SHEET);
    expect(scene).toBe(
      'Victoria, a girl about seven years old with curly red hair, freckles, yellow overalls and red rain boots, runs laughing across the golden meadow with Biscuit, a small fluffy brown puppy with floppy ears and a blue collar, at her heels.'
    );
  });

  it('reuses an existing comma instead of doubling it', () => {
    const scene = anchorSceneWithSheet('Victoria, laughing, spins in a circle.', SHEET);
    expect(scene).toBe(
      'Victoria, a girl about seven years old with curly red hair, freckles, yellow overalls and red rain boots, laughing, spins in a circle.'
    );
  });

  it('anchors each character only once, at their first mention', () => {
    const scene = anchorSceneWithSheet('Victoria calls Biscuit, and Biscuit comes running to Victoria.', SHEET);
    expect(scene.match(/fluffy brown puppy/g)).toHaveLength(1);
    expect(scene.match(/yellow overalls/g)).toHaveLength(1);
  });

  it('never stacks a second look on a character the brief already described verbatim', () => {
    const described = 'Victoria, a girl about seven years old with curly red hair, freckles, yellow overalls and red rain boots, waves from the gate.';
    expect(anchorSceneWithSheet(described, SHEET)).toBe(described);
  });

  it('never stacks a second look on a character with a paraphrased appositive', () => {
    const paraphrased = 'Victoria, a red-haired seven-year-old in yellow overalls, waves from the gate.';
    expect(anchorSceneWithSheet(paraphrased, SHEET)).toBe(paraphrased);
  });

  it('skips possessives and anchors the next real mention', () => {
    const scene = anchorSceneWithSheet("Victoria's backpack slips from her shoulder as Victoria runs.", SHEET);
    expect(scene).toContain("Victoria's backpack slips");
    expect(scene).toContain('as Victoria, a girl about seven years old');
  });

  it('leaves scenes untouched when no sheet character is present', () => {
    const sceneText = 'A red kite soars over the empty beach.';
    expect(anchorSceneWithSheet(sceneText, SHEET)).toBe(sceneText);
  });
});

describe('buildExactCountClause', () => {
  it('states the census and separates animal features from the human child', () => {
    const clause = buildExactCountClause('Victoria kneels beside Biscuit.', SHEET);
    expect(clause).toContain('exactly one girl and exactly one puppy');
    expect(clause).toContain('no duplicates');
    expect(clause).toContain('no twins');
    expect(clause).toContain('belong only to the puppy');
    expect(clause).toContain('completely normal human with no animal features');
  });

  it('counts two characters of the same kind correctly', () => {
    const twoGirls: CharacterSheet = [
      Victoria,
      { name: 'Priya', countNoun: 'girl', isAnimal: false, descriptor: 'a girl with a long black braid in a teal dress' },
    ];
    const clause = buildExactCountClause('Victoria and Priya build a sandcastle.', twoGirls);
    expect(clause).toContain('exactly two girls');
    expect(clause).not.toContain('animal features');
  });

  it('pluralises the animal noun in the no-extras guard', () => {
    const clause = buildExactCountClause('Biscuit chases a butterfly.', SHEET);
    expect(clause).toContain('exactly one puppy');
    expect(clause).toContain('extra puppies');
    expect(clause).not.toContain('belong only to');
  });

  it('is empty when the scene names nobody from the sheet', () => {
    expect(buildExactCountClause('Waves roll onto the quiet shore.', SHEET)).toBe('');
  });
});

describe('buildChildrenCoverScene', () => {
  it('features the real cast in their frozen looks, with the book premise', () => {
    const scene = buildChildrenCoverScene(
      "Victoria and Biscuit's Great Meadventure",
      'adventure',
      SHEET,
      'A little girl and her puppy explore the farm and race across the wildflower meadow.'
    );
    expect(scene).toContain('Victoria, a girl about seven years old with curly red hair');
    expect(scene).toContain('Biscuit, a small fluffy brown puppy');
    expect(scene).toContain('explore the farm');
    expect(scene).toContain('exactly one girl');
    expect(scene).toContain('No text, no letters, no words');
    expect(scene).toContain('empty space at the top');
  });

  it('features at most three characters so the cover stays uncluttered', () => {
    const four: CharacterSheet = [
      ...SHEET,
      { name: 'Nana Rose', countNoun: 'grandmother', isAnimal: false, descriptor: 'a grandmother with silver hair in a bun and a floral apron' },
    ];
    const scene = buildChildrenCoverScene('Farm Days', 'adventure', four, null);
    expect(scene).toContain('Dada');
    expect(scene).not.toContain('Nana Rose');
  });

  it('falls back to the book premise when there is no sheet', () => {
    const scene = buildChildrenCoverScene('The Brave Little Fox', 'animals', [], 'A young fox learns to cross the river.');
    expect(scene).toContain('A young fox learns to cross the river.');
    expect(scene).toContain('No text, no letters, no words');
  });

  it('falls back to the legacy template only when it knows nothing about the book', () => {
    expect(buildChildrenCoverScene('Mystery Book', 'mystery')).toBe(
      `Children's book cover for "Mystery Book". mystery genre. Bright, colorful, inviting, no text.`
    );
  });
});

describe('guessFallbackSheet', () => {
  it('identifies the puppy and the girl from name-bound constructions', () => {
    const sheet = guessFallbackSheet(
      ['Victoria', 'Biscuit'],
      'Victoria, a curious girl of seven, raced her puppy Biscuit across the meadow. Biscuit barked at the butterflies.'
    );
    expect(sheet[0]).toMatchObject({ name: 'Victoria', countNoun: 'girl', isAnimal: false });
    expect(sheet[1]).toMatchObject({ name: 'Biscuit', countNoun: 'puppy', isAnimal: true, descriptor: 'a puppy' });
  });

  it('never calls the owner an animal because her sentence mentions one', () => {
    const sheet = guessFallbackSheet(
      ['Victoria', 'Biscuit'],
      'Victoria raced her puppy Biscuit across the meadow while the cat watched from the fence.'
    );
    expect(sheet[0].countNoun).toBe('character');
    expect(sheet[0].isAnimal).toBe(false);
    expect(sheet[1]).toMatchObject({ countNoun: 'puppy', isAnimal: true });
  });

  it('uses behaviour evidence when the name is the subject', () => {
    const sheet = guessFallbackSheet(['Biscuit'], 'Biscuit wagged his tail and then Biscuit barked twice.');
    expect(sheet[0]).toMatchObject({ countNoun: 'dog', isAnimal: true });
  });

  it('stays silent when the text binds no kind to the name', () => {
    const sheet = guessFallbackSheet(['Victoria'], 'Victoria opened the gate and smiled at the sunrise.');
    expect(sheet[0]).toEqual({ name: 'Victoria', countNoun: 'character', isAnimal: false, descriptor: '' });
  });
});

describe('parseSheetJson', () => {
  it('extracts the array from a fenced, chatty LLM reply', () => {
    const raw = 'Here is the sheet:\n```json\n[{"name":"Victoria","countNoun":"girl","isAnimal":false,"descriptor":"a girl with curly red hair in yellow overalls"}]\n```\nHope that helps!';
    const sheet = parseSheetJson(raw);
    expect(sheet).toHaveLength(1);
    expect(sheet[0].descriptor).toBe('a girl with curly red hair in yellow overalls');
  });

  it('returns nothing for unparseable output', () => {
    expect(parseSheetJson('Victoria is a girl and Biscuit is a puppy.')).toEqual([]);
    expect(parseSheetJson('')).toEqual([]);
  });
});

describe('buildCharacterSheet', () => {
  beforeEach(() => {
    mockAskLLM.mockReset();
  });

  it('freezes the looks the extraction returns for the whole cast', async () => {
    mockAskLLM.mockResolvedValue(JSON.stringify([Victoria, BISCUIT]));

    const sheet = await buildCharacterSheet({
      names: ['Victoria', 'Biscuit'],
      description: 'A girl and her puppy on a farm.',
      sampleProse: 'Victoria pulled on her red boots. Biscuit barked at the door.',
    });

    expect(sheet).toHaveLength(2);
    expect(sheet[0].descriptor).toContain('yellow overalls');
    expect(isCompleteSheet(sheet)).toBe(true);
  });

  it('backfills a cast member the LLM dropped and ignores invented extras', async () => {
    mockAskLLM.mockResolvedValue(JSON.stringify([
      Victoria,
      { name: 'Sparkles', countNoun: 'unicorn', isAnimal: true, descriptor: 'a pink unicorn with a glittering horn' },
    ]));

    const sheet = await buildCharacterSheet({
      names: ['Victoria', 'Biscuit'],
      description: 'A girl and her puppy on a farm.',
      sampleProse: 'Victoria raced her puppy Biscuit across the meadow.',
    });

    expect(sheet.map((e) => e.name)).toEqual(['Victoria', 'Biscuit']);
    expect(sheet[1]).toMatchObject({ countNoun: 'puppy', isAnimal: true });
  });

  it('falls back to the guessed sheet when the LLM is unreachable', async () => {
    mockAskLLM.mockRejectedValue(new Error('504 gateway timeout'));

    const sheet = await buildCharacterSheet({
      names: ['Victoria', 'Biscuit'],
      description: 'A girl and her puppy on a farm.',
      sampleProse: 'Victoria raced her puppy Biscuit across the meadow.',
    });

    expect(sheet.map((e) => e.name)).toEqual(['Victoria', 'Biscuit']);
    expect(sheet[1].countNoun).toBe('puppy');
    // Too weak to freeze: the next chapter must retry the real extraction.
    expect(isCompleteSheet(sheet)).toBe(false);
  });

  it('falls back when the LLM returns prose instead of JSON', async () => {
    mockAskLLM.mockResolvedValue('Victoria is a girl with red hair and Biscuit is her puppy.');

    const sheet = await buildCharacterSheet({
      names: ['Victoria', 'Biscuit'],
      sampleProse: 'Victoria raced her puppy Biscuit across the meadow.',
    });

    expect(sheet[1]).toMatchObject({ countNoun: 'puppy', isAnimal: true });
  });

  it('does not call the LLM when there is nothing for it to read', async () => {
    const sheet = await buildCharacterSheet({ names: ['Victoria'] });
    expect(mockAskLLM).not.toHaveBeenCalled();
    expect(sheet).toEqual([{ name: 'Victoria', countNoun: 'character', isAnimal: false, descriptor: '' }]);
  });
});

// The production cast format that defeated round 1: users type the whole
// character spec into the name fields, in shouty caps. Every stage keyed off
// the decorated string, so nothing matched, nothing froze, and the census
// never fired (books.characterSheet stayed NULL on a live book).
const DECORATED_CAST = ['VICTORIA (4 YEAR OLD GIRL)', 'DADA (RED HAIRED IRISHMAN)', 'TRUFFLE (BLACK LAB/RETRIEVER)'];

describe('parseCastEntry', () => {
  it('splits a parenthetical spec into a clean name and the hint', () => {
    expect(parseCastEntry('VICTORIA (4 YEAR OLD GIRL)')).toEqual({ name: 'Victoria', hint: '4 YEAR OLD GIRL' });
    expect(parseCastEntry('DADA (RED HAIRED IRISHMAN)')).toEqual({ name: 'Dada', hint: 'RED HAIRED IRISHMAN' });
  });

  it('title-cases shouted names but leaves normal names untouched', () => {
    expect(parseCastEntry('TRUFFLE')).toEqual({ name: 'Truffle', hint: '' });
    expect(parseCastEntry('Biscuit')).toEqual({ name: 'Biscuit', hint: '' });
    expect(parseCastEntry('Nana Rose')).toEqual({ name: 'Nana Rose', hint: '' });
  });

  it('splits a spaced dash spec but never a hyphenated name', () => {
    expect(parseCastEntry('Victoria - 4 year old girl')).toEqual({ name: 'Victoria', hint: '4 year old girl' });
    expect(parseCastEntry('Anne-Marie')).toEqual({ name: 'Anne-Marie', hint: '' });
  });
});

describe('decorated cast entries (the NULL-sheet regression)', () => {
  beforeEach(() => {
    mockAskLLM.mockReset();
  });

  it('the guessed sheet alone is complete enough to freeze from user hints', () => {
    const sheet = guessFallbackSheet(DECORATED_CAST, 'Victoria steps onto the boat. Dada smiles. Truffle wags his tail.');
    expect(sheet.map((e) => e.name)).toEqual(['Victoria', 'Dada', 'Truffle']);
    expect(sheet[0]).toMatchObject({ countNoun: 'girl', isAnimal: false, descriptor: 'a 4 year old girl' });
    expect(sheet[1]).toMatchObject({ countNoun: 'man', isAnimal: false, descriptor: 'a red haired irishman' });
    expect(sheet[2]).toMatchObject({ countNoun: 'dog', isAnimal: true, descriptor: 'a black lab/retriever' });
    expect(isCompleteSheet(sheet)).toBe(true);
  });

  it('still freezes a hint-based sheet when every LLM is rate-limited', async () => {
    mockAskLLM.mockRejectedValue(new Error('429 Too Many Requests'));

    const sheet = await buildCharacterSheet({
      names: DECORATED_CAST,
      description: 'A little girl, her dada and their dog go on a boat.',
      sampleProse: 'Look! A big boat. Victoria walks on. Dada walks on. Truffle walks on. Wiggle, waggle, waggle!',
    });

    expect(sheet.map((e) => e.name)).toEqual(['Victoria', 'Dada', 'Truffle']);
    expect(isCompleteSheet(sheet)).toBe(true);
  });

  it('merges clean extraction names onto the decorated cast and passes hints as authoritative', async () => {
    mockAskLLM.mockResolvedValue(JSON.stringify([
      { name: 'Victoria', countNoun: 'girl', isAnimal: false, descriptor: 'a tiny 4-year-old girl, only as tall as an adult\'s knee, with brown pigtails in a yellow sundress' },
      { name: 'Dada', countNoun: 'father', isAnimal: false, descriptor: 'a tall red-haired father with a short beard in a blue shirt' },
      { name: 'Truffle', countNoun: 'dog', isAnimal: true, descriptor: 'a big black labrador retriever with a red collar' },
    ]));

    const sheet = await buildCharacterSheet({
      names: DECORATED_CAST,
      description: 'A little girl, her dada and their dog go on a boat.',
      sampleProse: 'Victoria walks on. Dada walks on. Truffle walks on.',
    });

    expect(sheet.map((e) => e.name)).toEqual(['Victoria', 'Dada', 'Truffle']);
    expect(sheet[0].descriptor).toContain('4-year-old');
    const userPrompt = mockAskLLM.mock.calls[0][1];
    expect(userPrompt).toContain('- Victoria — described by the user as: 4 YEAR OLD GIRL');
    expect(userPrompt).toContain('- Truffle — described by the user as: BLACK LAB/RETRIEVER');
  });

  it('anchors ALL-CAPS mentions in toddler-book scenes', () => {
    const sheet: CharacterSheet = [
      { name: 'Victoria', countNoun: 'girl', isAnimal: false, descriptor: 'a 4 year old girl' },
      { name: 'Truffle', countNoun: 'dog', isAnimal: true, descriptor: 'a black lab/retriever' },
    ];
    const scene = anchorSceneWithSheet('VICTORIA throws the ball and TRUFFLE jumps into the water with a big splash.', sheet);
    expect(scene).toContain('VICTORIA, a 4 year old girl, throws');
    expect(scene).toContain('TRUFFLE, a black lab/retriever, jumps');
  });

  it('the census finally fires for the decorated-cast book', () => {
    const sheet = guessFallbackSheet(DECORATED_CAST, 'Victoria walks on. Dada walks on. Truffle walks on.');
    const clause = buildExactCountClause('Victoria, Dada and Truffle step onto the bright blue boat.', sheet);
    expect(clause).toContain('exactly one girl');
    expect(clause).toContain('exactly one man');
    expect(clause).toContain('exactly one dog');
    expect(clause).toContain('belong only to the dog');
  });
});

describe('applyCharacterSheetToScene', () => {
  it('leads with the census, then the anchored scene, then feature separation', () => {
    const out = applyCharacterSheetToScene('Victoria kneels beside Biscuit in the garden.', SHEET);
    const censusAt = out.indexOf('exactly one girl');
    const sceneAt = out.indexOf('Victoria, a girl about seven');
    const separationAt = out.indexOf('belong only to the puppy');
    expect(censusAt).toBeGreaterThanOrEqual(0);
    expect(censusAt).toBeLessThan(sceneAt);
    expect(sceneAt).toBeLessThan(separationAt);
  });

  it('returns the scene untouched when no sheet character is present', () => {
    const scene = 'Waves roll onto the quiet shore.';
    expect(applyCharacterSheetToScene(scene, SHEET)).toBe(scene);
    expect(applyCharacterSheetToScene(scene, [])).toBe(scene);
  });

  it('censusParts splits lead and separation, and the combined clause keeps its wording', () => {
    const scene = 'Victoria kneels beside Biscuit.';
    const { lead, separation } = censusParts(scene, SHEET);
    expect(lead).toContain('exactly one girl and exactly one puppy');
    expect(separation).toContain('belong only to the puppy');
    expect(buildExactCountClause(scene, SHEET)).toBe(`${lead} ${separation}`);
    expect(censusParts('Empty beach.', SHEET)).toEqual({ lead: '', separation: '' });
  });
});
