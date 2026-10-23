// HydraSkript - Canonical Character Sheet
//
// Text-to-image has no memory: left alone, every chapter's brief re-invents
// what the cast looks like from that chapter's prose, so the heroine's hair,
// outfit and even her dog's species drift page to page. The character sheet
// fixes that at the source. Each character's appearance is decided ONCE —
// taken from the book setup and the first prose where the text describes it,
// invented (and frozen) where the text is silent — stored on the book, and
// then copied VERBATIM into every illustration brief, every final prompt and
// the cover. Nobody downstream is allowed to re-invent a look.
//
// This module also owns the two deterministic prompt guards that used to be
// left to chance:
//   - anchoring: if a scene mentions a character by bare name, their sheet
//     descriptor is spliced in as an appositive ("Victoria, a girl about
//     seven with curly red hair…"). This rescues the heuristic fallback
//     briefs, which quote raw prose with no appearance words at all.
//   - exact counts: "exactly one girl and exactly one puppy — no duplicates,
//     no twins, no extra people", plus human/animal feature separation so
//     the puppy's tail and ears never bleed onto the child.

import { askLLMWithFallback } from '@/lib/llm/fallback';
import { selectChapterExcerpt } from '@/lib/services/illustrationBrief';

/** One character's frozen look. `descriptor` is the exact phrase pasted into prompts. */
export interface CharacterSheetEntry {
  name: string;
  /** One short countable noun for what they are: "girl", "father", "puppy". */
  countNoun: string;
  isAnimal: boolean;
  /** Appositive appearance phrase, e.g. "a small fluffy brown puppy with floppy ears and a blue collar". */
  descriptor: string;
}

export type CharacterSheet = CharacterSheetEntry[];

/** Descriptors shorter than this carry no appearance information worth anchoring. */
const MIN_ANCHOR_DESCRIPTOR = 5;
/** A sheet is only frozen to the book when every descriptor is a real look. */
const MIN_CANONICAL_DESCRIPTOR = 15;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "a", "a and b", "a, b and c" — semicolon mode for clauses that contain commas. */
function joinEnglish(parts: string[], semicolons = false): string {
  const clean = parts.filter((p) => p.trim().length > 0);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  const sep = semicolons ? '; ' : ', ';
  return `${clean.slice(0, -1).join(sep)} and ${clean[clean.length - 1]}`;
}

function pluralize(noun: string): string {
  if (/(s|x|z|ch|sh)$/.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/**
 * Normalise a descriptor coming back from the LLM (or JSON storage) into the
 * mid-sentence appositive form prompts need: lowercase article first, no
 * trailing full stop, single-spaced, length-capped.
 */
export function normalizeDescriptor(raw: string): string {
  let descriptor = raw.trim().replace(/\s+/g, ' ').replace(/[.]+$/, '');
  if (!descriptor) return '';
  if (/^(a|an|the)\b/i.test(descriptor)) {
    descriptor = descriptor.charAt(0).toLowerCase() + descriptor.slice(1);
  } else {
    descriptor = `a ${descriptor.charAt(0).toLowerCase()}${descriptor.slice(1)}`;
  }
  return descriptor.slice(0, 180);
}

/** One cast entry as the user typed it, split into a clean name + description hint. */
export interface CastEntry {
  name: string;
  hint: string;
}

/**
 * Users rarely type a bare name into the cast fields — they type the whole
 * character spec: "VICTORIA (4 YEAR OLD GIRL)", "DADA (RED HAIRED IRISHMAN)".
 * Treating that decorated string as the character's NAME broke every stage
 * in production: extraction returned sane names ("Victoria") that never
 * matched the cast ("VICTORIA (4 YEAR OLD GIRL)"), the guessed fallback
 * found no kind for a parenthetical, nothing was ever complete enough to
 * freeze (books.characterSheet stayed NULL), and presence detection searched
 * briefs for a string they never contain — so the exact-count census never
 * fired and the second dog survived. Split the spec instead: the name
 * becomes matchable, and the hint is user-authored ground truth about age,
 * species and look that both the extraction and the fallback can trust.
 */
export function parseCastEntry(raw: string): CastEntry {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  let name = text;
  let hint = '';

  const parenAt = text.indexOf('(');
  if (parenAt > 0) {
    const closeAt = text.indexOf(')', parenAt);
    name = text.slice(0, parenAt).trim();
    hint = (closeAt > parenAt ? text.slice(parenAt + 1, closeAt) : text.slice(parenAt + 1)).trim();
  } else {
    // "Victoria - 4 year old girl" (spaced dash/colon only, so hyphenated
    // names like Anne-Marie are never split).
    const dash = text.match(/^(.{1,40}?)\s+[-–—:]\s+(.{3,})$/);
    if (dash) {
      name = dash[1].trim();
      hint = dash[2].trim();
    }
  }

  return { name: tidyCastName(name), hint };
}

/** "VICTORIA" → "Victoria": prompts and name matching want a normal-case name. */
function tidyCastName(name: string): string {
  const cleaned = name.replace(/[\s,;:]+$/g, '').trim();
  const letters = cleaned.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 2 && cleaned === cleaned.toUpperCase()) {
    return cleaned
      .split(' ')
      .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word))
      .join(' ');
  }
  return cleaned;
}

/** "young girl" → "girl", "Fluffy Puppy" → "puppy": the countable head noun only. */
function normalizeCountNoun(raw: unknown): string {
  if (typeof raw !== 'string') return 'character';
  const words = raw.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
  return words[words.length - 1] || 'character';
}

function sanitizeEntry(raw: unknown): CharacterSheetEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return null;
  const descriptorRaw = typeof record.descriptor === 'string' ? record.descriptor : '';
  return {
    name: name.slice(0, 60),
    countNoun: normalizeCountNoun(record.countNoun),
    isAnimal: record.isAnimal === true,
    descriptor: descriptorRaw.trim() ? normalizeDescriptor(descriptorRaw) : '',
  };
}

/**
 * Parse the stored JSON sheet. Never throws — a corrupt sheet must degrade to
 * "no sheet" (today's behaviour), never break illustration generation.
 */
export function parseCharacterSheet(raw: string | null | undefined): CharacterSheet {
  if (!raw || typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const sheet: CharacterSheet = [];
    for (const item of parsed) {
      const entry = sanitizeEntry(item);
      if (!entry) continue;
      const key = entry.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sheet.push(entry);
      if (sheet.length >= 6) break;
    }
    return sheet;
  } catch {
    return [];
  }
}

export function serializeCharacterSheet(sheet: CharacterSheet): string {
  return JSON.stringify(sheet.slice(0, 6));
}

/**
 * Trait coverage: which identity-pinning details a descriptor actually
 * states. This replaced a LENGTH-only freeze gate (≥15 chars) that happily
 * froze "a 4 year old girl" (17 chars) as canon — the image model then
 * re-invented hair colour, skin tone and even apparent gender on every
 * page, because a text-to-image model holds ONLY what the words pin (the
 * same book's dog, "a black lab/retriever", and its green-polo father
 * never drifted). Detection looks for the canonical phrasings the
 * extraction / enrichment prompts are told to produce: a colour word
 * bound to hair, a colour word bound to "skin", a colour word bound to
 * a garment, and (for animals) a coat colour that isn't just an accessory.
 */
export interface DescriptorTraits {
  hair: boolean;
  skin: boolean;
  outfit: boolean;
  coat: boolean;
}

const TRAIT_COLOURS = [
  'black', 'brown', 'blonde', 'blond', 'red', 'ginger', 'auburn', 'grey', 'gray',
  'white', 'silver', 'golden', 'chestnut', 'sandy', 'copper', 'strawberry',
  'dark', 'light', 'pale', 'fair', 'olive', 'tan', 'tanned', 'bronze', 'ebony',
  'mahogany', 'cream', 'ivory', 'peach', 'rosy', 'deep', 'warm', 'rich',
  'orange', 'pink', 'purple', 'violet', 'blue', 'green', 'yellow', 'teal',
  'turquoise', 'maroon', 'burgundy', 'navy', 'beige', 'khaki', 'coral', 'lavender',
];
const COLOUR_PATTERN = TRAIT_COLOURS.join('|');

/** True when a colour word sits just in front of one of the anchor nouns, inside the same clause. */
function colourBefore(text: string, anchors: string[]): boolean {
  return anchors.some((anchor) => new RegExp(`\\b(?:${COLOUR_PATTERN})\\b[^,;]{0,24}?\\b${anchor}\\b`, 'i').test(text));
}

const GARMENT_ANCHORS = [
  'dress', 'sundress', 'overalls', 'dungarees', 'shirt', 't-shirt', 'top', 'blouse',
  'pants', 'trousers', 'jeans', 'shorts', 'skirt', 'leggings', 'boots', 'shoes',
  'sneakers', 'sandals', 'wellies', 'hat', 'cap', 'jacket', 'coat', 'sweater',
  'jumper', 'cardigan', 'gown', 'frock', 'cloak', 'apron', 'uniform', 'robe',
  'vest', 'pyjamas', 'pajamas', 'onesie', 'scarf', 'bow', 'ribbon', 'outfit',
];

/** True when some colour in the text is not merely decorating an accessory ("a blue collar"). */
function hasNonAccessoryColour(text: string): boolean {
  const accessory = /\b(collar|bow|bandana|ribbon|bell|saddle|blanket|harness|leash|scarf|hat)\b/;
  const re = new RegExp(`\\b(?:${COLOUR_PATTERN})\\b`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!accessory.test(text.slice(m.index + m[0].length, m.index + m[0].length + 18))) return true;
  }
  return false;
}

export function descriptorTraits(entry: CharacterSheetEntry): DescriptorTraits {
  const d = (entry.descriptor ?? '').toLowerCase();
  const hair =
    /\bbald\b/.test(d) ||
    colourBefore(d, ['hair(?:ed)?', 'pigtails?', 'braids?', 'ponytail', 'curls', 'hijab', 'turban', 'headscarf']);
  const skin = colourBefore(d, ['skin(?:ned)?', 'complexion']);
  const outfit = colourBefore(d, GARMENT_ANCHORS);
  const coat = entry.isAnimal
    ? colourBefore(d, ['fur', 'coat', 'feathers', 'scales', 'mane']) ||
      /\b(spotted|striped|speckled|mottled)\b/.test(d) ||
      hasNonAccessoryColour(d)
    : false;
  return { hair, skin, outfit, coat };
}

/**
 * True when a descriptor pins enough of the look to be frozen as canon:
 * humans need hair colour, skin tone and a coloured signature outfit;
 * animals need a coat colour. Anything thinner is used for the current
 * prompt but goes to enrichment (and is never stored), so a storm-day
 * "a 4 year old girl" can't become the book's permanent canon.
 */
export function descriptorHasFreezableLook(entry: CharacterSheetEntry): boolean {
  const d = (entry.descriptor ?? '').trim();
  if (d.length < MIN_CANONICAL_DESCRIPTOR) return false;
  const t = descriptorTraits(entry);
  return entry.isAnimal ? t.coat : t.hair && t.skin && t.outfit;
}

export function isCompleteSheet(sheet: CharacterSheet): boolean {
  return sheet.length > 0 && sheet.every(descriptorHasFreezableLook);
}

/**
 * A human character's two most-drifted traits as one short phrase ("long
 * black hair in two braids and light golden-brown skin"), lifted verbatim
 * from the descriptor so the census can restate them at the prompt head.
 * Null when the descriptor pins neither (nothing truthful to restate).
 */
export function identityPhrase(entry: CharacterSheetEntry): string | null {
  if (entry.isAnimal) return null;
  const d = entry.descriptor ?? '';
  const tidy = (s: string) => s.trim().replace(/^(?:with|and|wearing)\s+/i, '').toLowerCase();
  // Only genuine style/tone modifiers may lead the captured phrase —
  // free-form leading words once produced "Dada has father with fair skin."
  const HAIR_MODIFIERS = 'long|short|curly|wavy|straight|thick|thin|messy|neat|shoulder-length|chin-length|flowing|silky|coily|kinky';
  const SKIN_MODIFIERS = 'deep|dark|light|warm|rich|pale|soft|bright|glowing|smooth|medium';

  let hair: string | null = null;
  const haired = new RegExp(`\\b(${COLOUR_PATTERN})-haired\\b`, 'i').exec(d);
  if (haired) {
    hair = `${haired[1].toLowerCase()} hair`;
  } else {
    const m = new RegExp(
      `((?:(?:${HAIR_MODIFIERS})\\s+){0,2}(?:${COLOUR_PATTERN})\\s+(?:hair|pigtails?|braids?|ponytail|curls)(?:\\s+in\\s+[^,;]+)?)`,
      'i'
    ).exec(d);
    if (m) hair = tidy(m[1]);
  }

  let skin: string | null = null;
  const s = new RegExp(`((?:(?:${SKIN_MODIFIERS})\\s+){0,2}(?:${COLOUR_PATTERN})[A-Za-z-]*\\s+skin\\w*)`, 'i').exec(d);
  if (s) skin = tidy(s[1]);

  if (hair && skin) return `${hair} and ${skin}`;
  return hair ?? skin;
}

/** The sheet entries whose name actually appears in a scene description. */
export function presentInScene(scene: string, sheet: CharacterSheet): CharacterSheetEntry[] {
  return sheet.filter((entry) => new RegExp(`\\b${escapeRegExp(entry.name)}\\b`, 'i').test(scene));
}

/**
 * Splice each present character's sheet descriptor into the scene as an
 * appositive at their first mention — unless the scene already describes
 * them (verbatim sheet copy, or any ", a …" appositive the brief writer
 * produced). Bare names are what let the image model invent a new child on
 * every page; this makes the frozen look structurally unavoidable, including
 * for heuristic fallback briefs that quote raw prose.
 */
export function anchorSceneWithSheet(scene: string, sheet: CharacterSheet): string {
  let result = scene;
  for (const entry of sheet) {
    const descriptor = entry.descriptor?.trim();
    if (!descriptor || descriptor.length < MIN_ANCHOR_DESCRIPTOR) continue;
    if (normalizeForCompare(result).includes(normalizeForCompare(descriptor))) continue;

    // Case-insensitive: toddler-book prose (and briefs echoing it) shout
    // names — "TRUFFLE sees the fish" — and a case-sensitive pattern silently
    // anchored nothing on exactly those pages.
    const namePattern = new RegExp(`\\b${escapeRegExp(entry.name)}\\b`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = namePattern.exec(result)) !== null) {
      const end = match.index + match[0].length;
      const after = result.slice(end, end + 14);
      // "Victoria's puppy" — a possessive is not a place to describe Victoria.
      if (/^['’]s\b/.test(after)) continue;
      // "Victoria, a girl with…" — already described; never stack two looks.
      if (/^,\s+(a|an|the)\s/i.test(after)) break;
      const rest = result.slice(end);
      const insertion = rest.startsWith(',') ? `, ${descriptor}` : `, ${descriptor},`;
      result = result.slice(0, end) + insertion + rest;
      break;
    }
  }
  return result;
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * The exact-count guard: diffusion models are notoriously weak counters, and
 * a cast list ("Recurring characters: Victoria, Biscuit") reads as MORE
 * characters to draw. Stating the census plainly — plus which being owns the
 * fur, ears and tail — is what stops the second dog, the bonus sibling, the
 * random boy, and the girl with a tail.
 */
export function buildExactCountClause(scene: string, sheet: CharacterSheet): string {
  const { lead, separation } = censusParts(scene, sheet);
  return [lead, separation].filter(Boolean).join(' ');
}

/**
 * The census as two separately placeable sentences. Position matters:
 * CLIP-window backends (Flux) weight the head of the prompt and may never
 * reach a census appended after a long scene — in production the trailing
 * clause let a second dog straight through. Chapter illustrations therefore
 * LEAD with the census and put the feature-separation sentence after the
 * scene (attribute binding tolerates later placement better than counting).
 */
export function censusParts(scene: string, sheet: CharacterSheet): { lead: string; separation: string } {
  const present = presentInScene(scene, sheet);
  if (present.length === 0) return { lead: '', separation: '' };

  const counts = new Map<string, number>();
  for (const entry of present) {
    const noun = (entry.countNoun || 'character').toLowerCase();
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  const census = [...counts.entries()].map(
    ([noun, count]) => `exactly ${NUMBER_WORDS[count] ?? count} ${count === 1 ? noun : pluralize(noun)}`
  );

  const humans = present.filter((e) => !e.isAnimal);
  const animals = present.filter((e) => e.isAnimal);
  let lead = `The scene contains ${joinEnglish(census)} — each character appears only once, with no duplicates, no twins and no extra ${humans.length > 0 ? 'people' : 'characters'}`;
  if (animals.length > 0) {
    const animalNouns = [...new Set(animals.map((e) => (e.countNoun || 'animal').toLowerCase()))];
    lead += ` or extra ${joinEnglish(animalNouns.map(pluralize))}`;
  }
  lead += '.';

  // Identity reinforcement at the prompt head. The anchored appositive in
  // the scene carries the full look, but in a solo scene with a long brief
  // it fights every other noun — the production failure was a playground
  // page that recast the heroine as a different child entirely (short
  // hair, apparent boy). Restating hair + skin beside the census, where
  // encoders listen hardest, gives the two most-drifted traits a second
  // anchor without a cast list (which reads as MORE characters to draw).
  const identities = humans
    .map((e) => {
      const phrase = identityPhrase(e);
      return phrase ? `${e.name} has ${phrase}.` : '';
    })
    .filter(Boolean);
  if (identities.length > 0) lead += ` ${identities.join(' ')}`;

  let separation = '';
  if (humans.length > 0 && animals.length > 0) {
    const animalNouns = joinEnglish([...new Set(animals.map((e) => (e.countNoun || 'animal').toLowerCase()))]);
    const humanNouns = joinEnglish([...new Set(humans.map((e) => (e.countNoun || 'person').toLowerCase()))]);
    separation = `Fur, animal ears, paws and a tail belong only to the ${animalNouns}; the ${humanNouns} is a completely normal human with no animal features.`;
  }
  return { lead, separation };
}

/**
 * The full deterministic sheet treatment for one chapter scene, in prompt
 * order: census first (inside every encoder's window), then the scene with
 * frozen descriptors anchored onto bare names, then feature separation.
 * Pure so the composition is unit-testable without the image backends.
 */
export function applyCharacterSheetToScene(scene: string, sheet: CharacterSheet): string {
  if (!sheet || sheet.length === 0) return scene;
  const anchored = anchorSceneWithSheet(scene, sheet);
  const { lead, separation } = censusParts(anchored, sheet);
  return [lead, anchored, separation].filter((part) => part.trim().length > 0).join(' ');
}

function sanitizeOneLine(text: string | null | undefined, maxChars: number): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').replace(/^["']+|["']+$/g, '').trim().slice(0, maxChars).trim();
}

/**
 * The children's cover scene, built from the actual book: its real cast in
 * their frozen looks, its real premise from the book description, composed
 * as a cover (heroes large and facing out, title space kept clear). The old
 * template named only the genre, so the model invented stranger children for
 * every cover. Degrades gracefully: sheet → description → legacy template.
 */
export function buildChildrenCoverScene(
  title: string,
  genre: string,
  sheet?: CharacterSheet,
  description?: string | null
): string {
  const premise = sanitizeOneLine(description, 220);
  const featured = (sheet ?? []).filter((e) => e.descriptor.trim().length >= MIN_ANCHOR_DESCRIPTOR).slice(0, 3);

  if (featured.length > 0) {
    const castText = joinEnglish(featured.map((e) => `${e.name}, ${e.descriptor.trim()}`), true);
    const countClause = buildExactCountClause(castText, featured);
    const premiseText = premise ? ` that captures the story: ${premise}` : '';
    return `Front cover of the children's picture book "${title}". ${castText}, together in one warm, joyful hero moment${premiseText}. The characters are large in the foreground, facing the viewer with bright, welcoming expressions, against a simple uncluttered background with clear empty space at the top of the frame for the title. ${countClause} Bright, colorful, inviting. No text, no letters, no words anywhere in the image.`;
  }

  if (premise) {
    return `Front cover of the children's picture book "${title}". ${premise} The book's main characters are large in the foreground, facing the viewer with bright, welcoming expressions, against a simple uncluttered background with clear empty space at the top of the frame for the title. Bright, colorful, inviting. No text, no letters, no words anywhere in the image.`;
  }

  return `Children's book cover for "${title}". ${genre} genre. Bright, colorful, inviting, no text.`;
}

/**
 * What-is-this-character hints for the no-LLM fallback. Species correctness
 * is the one thing that must never be guessed wrong (the kitten-for-a-dog
 * regression), and the dangerous sentence in children's prose is "Victoria
 * raced her puppy Biscuit" — a loose scan of that sentence would call the
 * GIRL a puppy. So hints are only accepted from constructions that bind the
 * kind-word to the name itself: "her puppy Biscuit", "Biscuit, a fluffy
 * puppy", "Biscuit was a puppy", "Biscuit the puppy", "Biscuit barked".
 * Anything weaker yields a safe kind-less entry, never a wrong species.
 */
const ANIMAL_HINTS: Array<{ countNoun: string; nouns: string[]; verbs: string[] }> = [
  { countNoun: 'puppy', nouns: ['puppy', 'pup'], verbs: [] },
  { countNoun: 'dog', nouns: ['dog', 'hound', 'lab', 'labrador', 'retriever', 'poodle', 'bulldog', 'terrier', 'spaniel', 'corgi', 'husky', 'beagle', 'dachshund', 'collie', 'pug'], verbs: ['barked', 'barks', 'wagged', 'wags', 'woofed'] },
  { countNoun: 'kitten', nouns: ['kitten', 'kitty'], verbs: [] },
  { countNoun: 'cat', nouns: ['cat'], verbs: ['meowed', 'meows', 'purred', 'purrs'] },
  { countNoun: 'pony', nouns: ['pony'], verbs: [] },
  { countNoun: 'horse', nouns: ['horse', 'foal', 'mare', 'stallion'], verbs: ['neighed', 'neighs', 'galloped', 'gallops'] },
  { countNoun: 'rabbit', nouns: ['rabbit', 'bunny'], verbs: [] },
  { countNoun: 'bear', nouns: ['bear'], verbs: [] },
  { countNoun: 'fox', nouns: ['fox'], verbs: [] },
  { countNoun: 'mouse', nouns: ['mouse', 'rat'], verbs: [] },
  { countNoun: 'pig', nouns: ['pig', 'piglet'], verbs: ['oinked'] },
  { countNoun: 'cow', nouns: ['cow', 'bull', 'calf'], verbs: [] },
  { countNoun: 'lamb', nouns: ['lamb'], verbs: [] },
  { countNoun: 'sheep', nouns: ['sheep'], verbs: [] },
  { countNoun: 'frog', nouns: ['frog', 'toad'], verbs: ['croaked', 'croaks'] },
  { countNoun: 'dragon', nouns: ['dragon'], verbs: [] },
  { countNoun: 'bird', nouns: ['bird', 'chick'], verbs: [] },
  { countNoun: 'duck', nouns: ['duck', 'duckling'], verbs: ['quacked', 'quacks'] },
  { countNoun: 'owl', nouns: ['owl'], verbs: ['hooted', 'hoots'] },
  { countNoun: 'fish', nouns: ['fish', 'goldfish'], verbs: [] },
];

const PERSON_HINTS: Array<{ countNoun: string; nouns: string[] }> = [
  { countNoun: 'girl', nouns: ['girl', 'daughter'] },
  { countNoun: 'boy', nouns: ['boy', 'son'] },
  { countNoun: 'baby', nouns: ['baby', 'toddler', 'infant'] },
  { countNoun: 'sister', nouns: ['sister'] },
  { countNoun: 'brother', nouns: ['brother'] },
  { countNoun: 'father', nouns: ['father', 'dad', 'dada', 'papa', 'daddy'] },
  { countNoun: 'mother', nouns: ['mother', 'mom', 'mum', 'mama', 'mommy', 'mummy'] },
  { countNoun: 'grandmother', nouns: ['grandmother', 'grandma', 'granny', 'nana'] },
  { countNoun: 'grandfather', nouns: ['grandfather', 'grandpa'] },
  { countNoun: 'princess', nouns: ['princess'] },
  { countNoun: 'prince', nouns: ['prince'] },
  { countNoun: 'woman', nouns: ['woman', 'lady'] },
  { countNoun: 'man', nouns: ['man', 'gentleman'] },
];

/** The first kind-word inside a small window bound to a name, whichever list it is on. */
function firstHintInWindow(windowText: string): { countNoun: string; isAnimal: boolean } | null {
  const candidates: Array<{ index: number; countNoun: string; isAnimal: boolean }> = [];
  const collect = (hints: Array<{ countNoun: string; nouns: string[] }>, isAnimal: boolean) => {
    for (const hint of hints) {
      for (const noun of hint.nouns) {
        const hit = new RegExp(`\\b${escapeRegExp(noun)}(?:s|es)?\\b`, 'i').exec(windowText);
        if (hit) candidates.push({ index: hit.index, countNoun: hint.countNoun, isAnimal });
      }
    }
  };
  collect(ANIMAL_HINTS, true);
  collect(PERSON_HINTS, false);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  const { countNoun, isAnimal } = candidates[0];
  return { countNoun, isAnimal };
}

/**
 * The kind named inside a user-authored cast hint ("4 YEAR OLD GIRL",
 * "RED HAIRED IRISHMAN", "BLACK LAB/RETRIEVER"). Unlike prose scanning this
 * needs no name-binding — the hint is about the character by construction —
 * but it does need suffix matching: "irishman" contains no standalone "man"
 * token for a word-boundary regex to find.
 */
function kindFromHintText(hint: string): { countNoun: string; isAnimal: boolean } | null {
  const direct = firstHintInWindow(hint);
  if (direct) return direct;
  const tokens = hint.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const token of tokens) {
    if (token.endsWith('woman')) return { countNoun: 'woman', isAnimal: false };
    if (token.endsWith('man')) return { countNoun: 'man', isAnimal: false };
    if (token.endsWith('girl')) return { countNoun: 'girl', isAnimal: false };
    if (token.endsWith('boy')) return { countNoun: 'boy', isAnimal: false };
  }
  return null;
}

function guessKindForName(name: string, text: string): { countNoun: string; isAnimal: boolean } | null {
  const n = escapeRegExp(name);

  // 1. Kind-word directly in front of the name: "her puppy Biscuit".
  const beforePattern = new RegExp(`\\b([A-Za-z]+)\\s+${n}\\b`, 'gi');
  let before: RegExpExecArray | null;
  while ((before = beforePattern.exec(text)) !== null) {
    const hit = firstHintInWindow(before[1]);
    if (hit) return hit;
  }

  // 2. Appositive / copula window after the name: "Biscuit, a fluffy puppy",
  //    "Biscuit — the fluffiest puppy", "Victoria was a curious girl".
  const appositive = new RegExp(
    `\\b${n}(?:\\s*,|\\s+[—-]\\s*|\\s+(?:is|was)\\b)\\s*(?:a|an|the)\\b([^.,;]{0,50})`,
    'i'
  ).exec(text);
  if (appositive) {
    const hit = firstHintInWindow(appositive[1]);
    if (hit) return hit;
  }

  // 3. "Biscuit the puppy".
  const thePattern = new RegExp(`\\b${n}\\s+the\\b([^.,;]{0,30})`, 'i').exec(text);
  if (thePattern) {
    const hit = firstHintInWindow(thePattern[1]);
    if (hit) return hit;
  }

  // 4. species-specific behaviour with the name as subject: "Biscuit barked".
  for (const hint of ANIMAL_HINTS) {
    if (hint.verbs.some((verb) => new RegExp(`\\b${n}\\s+${escapeRegExp(verb)}\\b`, 'i').test(text))) {
      return { countNoun: hint.countNoun, isAnimal: true };
    }
  }

  return null;
}

/**
 * The degraded-mode sheet, built without the LLM. User-authored cast hints
 * ("VICTORIA (4 YEAR OLD GIRL)") are ground truth — a hint-derived entry
 * carries the user's own age/species words as its descriptor. A hint that
 * itself pins the look (hair/skin/outfit colours, or a coat colour) can be
 * complete enough to freeze; a bare age/kind hint cannot (that freeze was
 * the identity-drift bug) and becomes an enrichment target instead.
 * Without a hint, the kind is taken only from prose constructions that
 * bind it to the name. A sheet that is still weak is used for the current
 * prompt but not frozen (see isCompleteSheet), so a later chapter retries
 * the real extraction.
 */
export function guessFallbackSheet(names: string[], text: string): CharacterSheet {
  const corpus = text || '';
  const seen = new Set<string>();
  const sheet: CharacterSheet = [];

  for (const raw of names) {
    const { name, hint } = parseCastEntry(raw ?? '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    if (hint) {
      // A hint can be idiomatic about the animal/person axis ("the bestest
      // boy" is a dog); strict prose evidence ("Truffle barked") outranks it
      // there. The descriptor still comes from the user's own words.
      const proseKind = guessKindForName(name, corpus);
      const kind = proseKind?.isAnimal ? proseKind : (kindFromHintText(hint) ?? proseKind);
      sheet.push({
        name,
        countNoun: kind?.countNoun ?? 'character',
        isAnimal: kind?.isAnimal ?? false,
        descriptor: normalizeDescriptor(hint.toLowerCase()),
      });
    } else {
      const kind = guessKindForName(name, corpus);
      sheet.push(
        kind
          ? { name, countNoun: kind.countNoun, isAnimal: kind.isAnimal, descriptor: `a ${kind.countNoun}` }
          : { name, countNoun: 'character', isAnimal: false, descriptor: '' }
      );
    }
    if (sheet.length >= 5) break;
  }
  return sheet;
}

/** Salvage a JSON array from an LLM reply that may be fenced or chatty. */
export function parseSheetJson(raw: string): CharacterSheet {
  const text = raw.replace(/```(?:json)?/gi, ' ');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const sheet: CharacterSheet = [];
    for (const item of parsed) {
      const entry = sanitizeEntry(item);
      if (!entry || entry.descriptor.trim().length < MIN_ANCHOR_DESCRIPTOR) continue;
      const key = entry.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sheet.push(entry);
    }
    return sheet;
  } catch {
    return [];
  }
}

const SHEET_SYSTEM_PROMPT = `You are the character designer for an illustrated children's book. Your character sheet becomes CANON: the illustrator copies it word for word on every page, so every appearance detail must be fixed, concrete and drawable.

For each main character return:
- name: the exact spelling used in the text
- countNoun: ONE short countable noun for what they are ("girl", "boy", "father", "puppy", "cat", "dragon")
- isAnimal: true only for non-human animals or creatures
- descriptor: ONE compact visual phrase (12-26 words) starting with "a" or "an", for example "a girl about seven years old with fair skin and freckles, curly red hair, yellow overalls and red rain boots" or "a small fluffy brown puppy with floppy ears and a blue collar". ONLY things a camera can see. For every HUMAN the descriptor MUST state all four: (1) what they are and roughly how old, (2) skin tone, written as "(tone) skin" (e.g. "fair skin", "light golden-brown skin", "deep brown skin"), (3) hair colour AND style, (4) a signature outfit WITH its colour. For every ANIMAL: its species plus its coat colour (and markings). No personality, no feelings, no backstory.

Rules:
- If the cast list includes a user-provided description for a character ("described by the user as: …"), those facts are AUTHORITATIVE: keep their age, species, colours and build exactly, and only add compatible visual details around them. Never upgrade a 4-year-old into an older child.
- A human descriptor with no skin tone, no hair colour, or no outfit colour is INVALID: whatever you leave unspecified, the illustrator re-invents differently on every page — the production failure was one heroine with ginger hair on page 1, drawn as a boy on page 3, and a different skin tone on page 8, all from the descriptor "a 4 year old girl".
- For young children, state their PHYSICAL SCALE next to adults inside the descriptor (e.g. "a tiny 4-year-old girl, only as tall as an adult's knee, …") — image models honour relative size far better than an age number alone, and without it they draw toddlers adult-sized.
- Take appearance details from the text whenever the text gives them — copy its colours, clothing and species exactly. Never contradict the text, and never change an animal into a different animal.
- Where the text gives no look for a character, INVENT a distinctive, memorable one that fits the story. This is the one moment invention is allowed: afterwards the sheet is frozen for the whole book.
- Every character in the cast list MUST get an entry, with the exact cast spelling of their name. Do not add characters who are not in the cast list. If the cast list is empty, identify the main characters from the text yourself (maximum 4).
- An animal companion's descriptor MUST state its species and coat colour plainly ("a fluffy brown puppy" — never "a loyal little friend").

Output ONLY a JSON array, no other text:
[{"name":"...","countNoun":"...","isAnimal":false,"descriptor":"a ..."}]`;

const ENRICH_SYSTEM_PROMPT = `You maintain the frozen character sheet for an illustrated children's book. Some entries are missing appearance details, and whatever a descriptor leaves unspecified the illustrator re-invents differently on every page — one book's heroine changed hair colour, skin tone and even apparent gender between pages because her descriptor only said "a 4 year old girl".

For each character listed, return the entry with its descriptor EXPANDED:
- Keep every fact already in the descriptor (age, species, colours, clothing, scale phrases like "only as tall as an adult's knee") — word for word where you can. Anything after "described by the user as:" is AUTHORITATIVE and must survive exactly.
- ADD only the missing details named for that character. Humans need: hair colour and style; skin tone written as "(tone) skin" (e.g. "fair skin", "light golden-brown skin", "deep brown skin"); a signature outfit with its colour. Animals need: coat colour (and markings if natural).
- Invent distinctive, story-appropriate details for anything unspecified — afterwards the sheet is frozen for the whole book.
- NEVER change a character's age, gender, species or name, and never contradict the story text.

Output ONLY a JSON array, no other text:
[{"name":"...","countNoun":"...","isAnimal":false,"descriptor":"a ..."}]`;

function missingTraitLabels(entry: CharacterSheetEntry): string {
  const t = descriptorTraits(entry);
  if (entry.isAnimal) return t.coat ? '' : 'coat colour';
  const missing = [
    !t.hair && 'hair colour and style',
    !t.skin && 'skin tone',
    !t.outfit && 'signature outfit with its colour',
  ].filter(Boolean);
  return missing.join(', ');
}

/**
 * Pin the identity traits a thin descriptor left unspecified, with one LLM
 * call that INVENTS the missing details once (they are then frozen with
 * the sheet) while keeping every existing fact. This is the self-healing
 * path for storm-day fallback sheets ("a 4 year old girl"), for extractions
 * that forgot skin tone, and for books whose sheets froze under the old
 * length-only gate. Best-effort and never throws: on any failure the input
 * sheet comes back untouched. A rewrite that would REMOVE an
 * already-pinned trait is rejected entry-by-entry — trading one drift for
 * another is not an upgrade. Kind (countNoun/isAnimal) is never taken
 * from the enrichment reply: species safety outranks the LLM's opinion.
 */
export async function enrichCharacterSheet(
  sheet: CharacterSheet,
  opts: { names?: string[]; description?: string | null; sampleProse?: string | null } = {}
): Promise<CharacterSheet> {
  const thin = sheet.filter((e) => !descriptorHasFreezableLook(e));
  if (thin.length === 0) return sheet;

  try {
    const hints = new Map<string, string>();
    for (const raw of opts.names ?? []) {
      const { name, hint } = parseCastEntry(raw ?? '');
      if (name && hint) hints.set(name.toLowerCase(), hint);
    }

    const castBlock = thin
      .map((e) => {
        const hint = hints.get(e.name.toLowerCase());
        return `- ${e.name} (${e.isAnimal ? 'animal' : 'human'} ${e.countNoun}) — current descriptor: "${e.descriptor || '(none)'}" — missing: ${missingTraitLabels(e) || 'more specific appearance detail'}${hint ? ` — described by the user as: ${hint}` : ''}`;
      })
      .join('\n');

    const description = (opts.description ?? '').trim();
    const prose = (opts.sampleProse ?? '').trim();
    const userPrompt = [
      'Characters whose descriptors are missing appearance details:',
      castBlock,
      description ? `\nBook description:\n${description.slice(0, 1200)}` : '',
      prose ? `\nStory text:\n${selectChapterExcerpt(prose, 3000)}` : '',
    ].join('\n');

    const enrichCall = askLLMWithFallback(ENRICH_SYSTEM_PROMPT, userPrompt, 0.3, 700);
    enrichCall.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutCall = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Character sheet enrichment timed out')), 30_000);
    });

    let raw: string;
    try {
      raw = await Promise.race([enrichCall, timeoutCall]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const enriched = parseSheetJson(raw);
    if (enriched.length === 0) return sheet;

    const byLowerName = new Map(enriched.map((e) => [parseCastEntry(e.name).name.toLowerCase(), e]));
    const applied: string[] = [];
    const out = sheet.map((entry) => {
      if (descriptorHasFreezableLook(entry)) return entry;
      const candidate = byLowerName.get(entry.name.toLowerCase())?.descriptor?.trim();
      if (!candidate) return entry;
      const before = descriptorTraits(entry);
      const after = descriptorTraits({ ...entry, descriptor: candidate });
      const regressed = (Object.keys(before) as Array<keyof DescriptorTraits>).some((k) => before[k] && !after[k]);
      if (regressed) return entry;
      applied.push(entry.name);
      return { ...entry, descriptor: candidate };
    });
    if (applied.length > 0) {
      console.log(`[CharacterSheet] Enriched thin descriptors with pinned traits: ${applied.join(', ')}`);
    }
    return out;
  } catch (e) {
    console.warn(
      '[CharacterSheet] Enrichment failed (non-fatal, sheet used as-is):',
      e instanceof Error ? e.message : e
    );
    return sheet;
  }
}

/**
 * Build the canonical sheet from the book setup (cast + description) and a
 * prose sample. One cheap LLM call; on any failure returns the guessed
 * fallback sheet so illustration generation is never blocked.
 */
export async function buildCharacterSheet(opts: {
  names?: string[];
  description?: string | null;
  sampleProse?: string | null;
}): Promise<CharacterSheet> {
  // Normalise the raw cast first: "VICTORIA (4 YEAR OLD GIRL)" becomes the
  // matchable name "Victoria" plus an authoritative hint. Every downstream
  // stage (extraction merge, fallback, brief, anchoring, census) keys off
  // the clean name — with the decorated string as the key, all of them
  // silently missed and no sheet was ever frozen.
  const cast: CastEntry[] = [];
  const seen = new Set<string>();
  for (const raw of opts.names ?? []) {
    const entry = parseCastEntry(raw ?? '');
    if (!entry.name) continue;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cast.push(entry);
    if (cast.length >= 5) break;
  }
  const names = cast.map((c) => c.name);
  const description = (opts.description ?? '').trim();
  const prose = (opts.sampleProse ?? '').trim();
  const fallback = guessFallbackSheet(opts.names ?? [], `${description}\n${prose}`);
  const enrichOpts = { names: opts.names, description: opts.description, sampleProse: prose };

  if (!description && !prose) return fallback;

  const castBlock =
    cast.length > 0
      ? `Cast (use these exact names):\n${cast
          .map((c) => (c.hint ? `- ${c.name} — described by the user as: ${c.hint}` : `- ${c.name}`))
          .join('\n')}`
      : 'Cast: (not given — identify the main characters from the story text)';
  const userPrompt = [
    castBlock,
    description ? `\nBook description:\n${description.slice(0, 1200)}` : '',
    prose ? `\nStory text:\n${selectChapterExcerpt(prose, 4500)}` : '',
  ].join('\n');

  try {
    const sheetCall = askLLMWithFallback(SHEET_SYSTEM_PROMPT, userPrompt, 0.3, 700);
    // If the timeout wins the race the provider call keeps running — swallow
    // its eventual rejection so it cannot surface as unhandled.
    sheetCall.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutCall = new Promise<never>((_, reject) => {
      // 30s: hint-derived fallback sheets are strong now, so a hung
      // free-tier provider should not hold the chapter (and the 300s
      // serverless invocation it rides in) hostage.
      timer = setTimeout(() => reject(new Error('Character sheet extraction timed out')), 30_000);
    });

    try {
      const raw = await Promise.race([sheetCall, timeoutCall]);
      const extracted = parseSheetJson(raw);
      if (extracted.length === 0) {
        console.warn('[CharacterSheet] Extraction returned no usable entries, using guessed sheet');
        return enrichCharacterSheet(fallback, enrichOpts);
      }
      if (names.length === 0) return enrichCharacterSheet(extracted.slice(0, 4), enrichOpts);

      // The cast list is authoritative: keep only its characters (under the
      // cast's clean name) and backfill anyone the LLM dropped with their
      // guessed entry, so nobody loses their anchor. Extracted names are
      // run through the same cast parser, in case a model echoes a
      // decorated spec back as the "name".
      const byLowerName = new Map(extracted.map((e) => [parseCastEntry(e.name).name.toLowerCase(), e]));
      const fallbackByName = new Map(fallback.map((e) => [e.name.toLowerCase(), e]));
      const merged = names.map((name) => {
        const hit = byLowerName.get(name.toLowerCase());
        return hit ? { ...hit, name } : (fallbackByName.get(name.toLowerCase()) ?? { name, countNoun: 'character', isAnimal: false, descriptor: '' });
      });
      // Pin any identity traits the extraction still left unspecified
      // (skin tone is the repeat offender) before this sheet can freeze.
      return enrichCharacterSheet(merged, enrichOpts);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    console.warn(
      '[CharacterSheet] Extraction LLM call failed, using guessed sheet:',
      e instanceof Error ? e.message : e
    );
    // Even on a storm-day fallback, give enrichment one chance to pin the
    // traits the hints don't carry — a shorter, narrower ask sometimes
    // lands when the full extraction timed out.
    return enrichCharacterSheet(fallback, enrichOpts);
  }
}

/**
 * Load the book's frozen sheet, building and storing it on first use.
 * Best-effort by design: returns [] (or an unstored guessed sheet) on any
 * failure so image generation proceeds exactly as it did before sheets
 * existed. The database is imported lazily to keep the pure helpers above
 * unit-testable without booting Prisma.
 */
export async function ensureCharacterSheet(bookId: string, sampleProse?: string): Promise<CharacterSheet> {
  try {
    const { db } = await import('@/lib/db');
    const book = await db.book.findUnique({
      where: { id: bookId },
      select: { characterSheet: true, characterNames: true, description: true },
    });
    if (!book) return [];

    const existing = parseCharacterSheet(book.characterSheet);
    if (existing.length > 0) {
      if (isCompleteSheet(existing)) return existing;
      // Frozen under the old length-only gate (or written before trait
      // coverage existed): a stored "a 4 year old girl" re-invents the
      // heroine on every remaining page of this book. Upgrade it in
      // place — enrichment keeps every existing fact and pins only the
      // missing traits — and store the result once it passes the
      // coverage gate. Until then the upgraded-but-unstored sheet is
      // still used for this job, and the next job retries.
      const upgraded = await enrichCharacterSheet(existing, {
        names: Array.isArray(book.characterNames) ? (book.characterNames as string[]) : [],
        description: book.description,
        sampleProse,
      });
      if (isCompleteSheet(upgraded)) {
        await db.book.update({
          where: { id: bookId },
          data: { characterSheet: serializeCharacterSheet(upgraded) },
        });
        console.log(
          `[CharacterSheet] Upgraded stored sheet for book ${bookId} with pinned traits: ${upgraded.map((e) => e.name).join(', ')}`
        );
      }
      return upgraded;
    }

    let prose = sampleProse?.trim() || '';
    if (!prose) {
      const firstChapter = await db.chapter.findFirst({
        where: { bookId, content: { not: '' } },
        orderBy: { index: 'asc' },
        select: { content: true },
      });
      prose = firstChapter?.content ?? '';
    }

    const sheet = await buildCharacterSheet({
      names: Array.isArray(book.characterNames) ? (book.characterNames as string[]) : [],
      description: book.description,
      sampleProse: prose,
    });

    if (isCompleteSheet(sheet)) {
      await db.book.update({
        where: { id: bookId },
        data: { characterSheet: serializeCharacterSheet(sheet) },
      });
      console.log(`[CharacterSheet] Froze canonical sheet for book ${bookId}: ${sheet.map((e) => e.name).join(', ')}`);
    } else if (sheet.length > 0) {
      console.log(`[CharacterSheet] Using unstored guessed sheet for book ${bookId} (will retry extraction next chapter)`);
    }
    return sheet;
  } catch (e) {
    console.warn('[CharacterSheet] ensureCharacterSheet failed (non-fatal):', e instanceof Error ? e.message : e);
    return [];
  }
}
