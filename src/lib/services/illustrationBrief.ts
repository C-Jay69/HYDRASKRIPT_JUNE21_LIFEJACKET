// HydraSkript - Illustration Brief Builder
//
// The chapter's artwork has to show what the page actually says. Two failure
// modes make the artwork irrelevant to the text:
//
//   1. The brief was written from a truncated slice of the chapter, so the
//      scene the artist got described the wrong part of the story.
//   2. The brief LLM call failed/timed out and the fallback grabbed the first
//      two sentences — the scene-setting, not the moment worth drawing.
//
// This module fixes both: the writer sees the whole chapter (head + tail when
// it has to be trimmed), and the fallback picks the most photographable
// sentences instead of the first ones.

import { askLLMWithFallback } from '@/lib/llm/fallback';

/** Words that describe a concrete, drawable action. */
const ACTION_VERBS =
  /\b(ran|run|running|walked|walk|walking|jumped|jump|jumping|climbed|climb|climbing|opened|open|opening|held|hold|holding|reached|reach|reaching|caught|catch|catching|threw|throw|throwing|carried|carry|carrying|looked|look|looking|stood|stand|standing|sat|sit|sitting|flew|fly|flying|swam|swim|swimming|turned|turn|turning|smiled|smile|smiling|laughed|laugh|laughing|shouted|shout|pointed|point|pointing|hugged|hug|hugging|waved|wave|waving|danced|dance|dancing|built|build|building|painted|paint|painting|crawled|crawl|brought|bring|found|find|discovered|helped|help|stepped|step|stepping|knocked|knock|dodged|dodge|leaped|leap|kicked|kick|rode|ride|riding|swung|swing|swinging|grabbed|grab|cupped|hold|leaned|lean|kneeled|kneel|whistled|whistle|sprinted|sprint|tiptoed|tiptoe|dove|dive|shrugged|shrug|blinked|blink|glanced|glance|peeked|peek|pulled|pull|pushing|pushed|tugged|tug|dropped|drop|lifted|lift|slipped|slip|landed|land|fell|fall|spun|spin|flung|hurried|hurry|crept|creep|shimmered|shimmer)\b/gi;

/** Concrete, visible nouns — the things that actually appear in a picture. */
const CONCRETE_NOUNS =
  /\b(hands?|hand|door|doors|roof|window|windows|tree|trees|rain|snow|sun|sky|water|river|sea|ocean|beach|road|path|trail|field|meadow|forest|woods|mountain|hill|cave|house|home|room|kitchen|bedroom|school|bridge|boat|kite|ball|book|books|lantern|candle|table|chair|fire|flame|flower|flowers|garden|star|stars|moon|night|morning|afternoon|wind|leaf|leaves|stone|stones|sand|city|street|streets|market|square|castle|tower|wagon|horse|pony|dog|puppy|cat|kitten|bird|fox|bear|bunny|rabbit|dragon|moth|butterfly|hill|cliff|bridge|ladder|toolbox|paint|paints|brush|crayon|kite|rope|rope|barrel|well|gate|fence|sign|postcard|letter|gift|cake|cup|plate|spoon|hat|cap|scarf|coat|dress|boots|shoes|basket|blanket|pillow|toy|doll|bus|truck|train|plane|kite|campfire|tent|sled|skate|balloon|pinwheel)\b/gi;

/** Words that mark a sentence as interior/abstract rather than visible. */
const ABSTRACT_WORDS =
  /\b(wanted|hoped|feared|knew|realised|realized|decided|remembered|thought|felt|believed|noticed|understood|seemed|missed|needed|should|could|would|might|perhaps|maybe|always|never|finally|suddenly|quietly|softly|warmly|inside|inside her|inside his|inside their)\b/gi;

/**
 * Split prose into sentences. Keeps the trailing punctuation so the excerpt
 * still reads as prose.
 */
export function splitSentences(content: string): string[] {
  const matches = content.match(/[^.!?\n]+[.!?]+["'”’)]*\s*/g);
  if (matches && matches.length > 0) {
    return matches.map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return content
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * How drawable a sentence is. Concrete actions and visible objects score
 * high; abstract narration and dialogue score low.
 */
export function scoreVisualSentence(sentence: string): number {
  const actionHits = (sentence.match(ACTION_VERBS) || []).length;
  const concreteHits = (sentence.match(CONCRETE_NOUNS) || []).length;
  const abstractHits = (sentence.match(ABSTRACT_WORDS) || []).length;
  const isQuoted = /["“”]/.test(sentence);
  const wordCount = sentence.split(/\s+/).filter(Boolean).length;
  // Very long sentences are usually a paragraph of narration, not a scene.
  const lengthPenalty = wordCount > 45 ? 1 : 0;
  // Interior narration ("she wanted to…") is weighted down hard: a sentence
  // that only reports a feeling cannot be drawn, whatever else it mentions.
  return actionHits * 2 + concreteHits * 0.75 - abstractHits * 2 - (isQuoted ? 0.75 : 0) - lengthPenalty;
}

/**
 * The sentences from a chapter that are worth drawing, best first.
 * Used when the brief LLM call fails — the old fallback took the first two
 * sentences, which is the setup, not the moment.
 */
export function pickVisualSentences(content: string, count = 2): string {
  const sentences = splitSentences(content);
  if (sentences.length === 0) return content.trim().slice(0, 300);

  const ranked = sentences
    .map((sentence, index) => ({ sentence, index, score: scoreVisualSentence(sentence) }))
    .sort((a, b) => (b.score === a.score ? a.index - b.index : b.score - a.score));

  const chosen = ranked
    .filter((s) => s.score > 0)
    .slice(0, count)
    // Keep the chapter's own reading order.
    .sort((a, b) => a.index - b.index);

  const picked = (chosen.length > 0 ? chosen : ranked.slice(0, count))
    .map((s) => s.sentence)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return picked.slice(0, 300);
}

/**
 * The slice of the chapter the brief writer sees.
 *
 * The head establishes who and where; the tail is where the chapter's turning
 * point usually lands. Truncating to the head alone (the old behaviour) hid
 * the best scene in every chapter that ran past ~2,800 characters — which is
 * every chapter of a 10–14 book.
 */
export function selectChapterExcerpt(content: string, budget = 6000): string {
  const text = content.trim();
  if (text.length <= budget) return text;
  const headLength = Math.floor(budget * 0.45);
  const tailLength = budget - headLength;
  return `${text.slice(0, headLength).trim()}\n\n[...]\n\n${text.slice(-tailLength).trim()}`;
}

/**
 * Strip the meta-commentary an LLM sometimes adds ("Here is the scene:",
 * quotes, trailing style notes) so the brief is pure scene description.
 */
export function sanitizeBrief(raw: string): string {
  return raw
    .replace(/^[`"'*_\s]+|[`"'*_\s]+$/g, '')
    .replace(/^\s*(here(?:'s| is)\s+the\s+(?:scene|brief|image|prompt)[^:]*:\s*)/i, '')
    .replace(/^\s*(scene|brief|image|prompt)\s*:\s*/i, '')
    // Never let the brief talk about the artwork itself.
    .replace(/\b(illustration|picture|artwork|render|3d render|image|prompt|photo|photograph|camera)\b/gi, 'scene')
    .replace(/\bpixar\b/gi, 'animated feature film')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Animal groups where naming the wrong species destroys the page (a kitten
 * standing in for the story's dog). `evidence` words prove the group is what
 * the chapter is actually about even when the prose only shows behaviour
 * ("barked, wagging his tail") instead of the noun.
 */
const ANIMAL_GROUPS: Array<{ label: string; nouns: string[]; evidence: string[] }> = [
  { label: 'cat', nouns: ['cat', 'kitten', 'kitty'], evidence: ['cat', 'kitten', 'kitty', 'meow', 'purr', 'purring'] },
  { label: 'dog', nouns: ['dog', 'puppy', 'pup', 'hound'], evidence: ['dog', 'puppy', 'pup', 'hound', 'bark', 'barked', 'barking', 'wag', 'wagged', 'wagging', 'woof'] },
  { label: 'horse', nouns: ['horse', 'pony', 'foal', 'mare', 'stallion'], evidence: ['horse', 'pony', 'foal', 'mare', 'stallion', 'neigh', 'neighed', 'gallop', 'galloped'] },
  { label: 'rabbit', nouns: ['rabbit', 'bunny'], evidence: ['rabbit', 'bunny'] },
  { label: 'bear', nouns: ['bear'], evidence: ['bear'] },
  { label: 'fox', nouns: ['fox'], evidence: ['fox'] },
  { label: 'mouse', nouns: ['mouse', 'rat'], evidence: ['mouse', 'mice', 'rat'] },
  { label: 'pig', nouns: ['pig', 'piglet'], evidence: ['pig', 'piglet', 'oink'] },
  { label: 'cow', nouns: ['cow', 'bull'], evidence: ['cow', 'bull', 'calf'] },
  { label: 'sheep', nouns: ['sheep', 'lamb'], evidence: ['sheep', 'lamb'] },
  { label: 'frog', nouns: ['frog', 'toad'], evidence: ['frog', 'toad', 'croak'] },
  { label: 'dragon', nouns: ['dragon'], evidence: ['dragon'] },
];

function mentionsAny(text: string, words: string[]): boolean {
  return words.some((w) => new RegExp(`\\b${w}(?:s|es)?\\b`, 'i').test(text));
}

/**
 * Returns a human-readable contradiction when the brief puts an animal in the
 * picture that the chapter contradicts — the brief's species never appears in
 * the chapter, while a DIFFERENT species clearly does. That mismatch is how a
 * chapter about Victoria and her dog shipped with a picture of a kitten: nothing
 * between the brief writer and the artist checked the animal against the page.
 *
 * Deliberately conservative: if the chapter offers animal evidence for no
 * group at all, the brief is allowed (it may have inferred correctly from
 * context we do not pattern-match). We only reject a proven contradiction.
 */
export function findBriefContradiction(brief: string, content: string): string | null {
  const briefGroups = ANIMAL_GROUPS.filter((g) => mentionsAny(brief, g.nouns));
  if (briefGroups.length === 0) return null;
  const chapterGroups = ANIMAL_GROUPS.filter((g) => mentionsAny(content, g.evidence));
  for (const group of briefGroups) {
    const supported = chapterGroups.some((g) => g.label === group.label);
    if (!supported && chapterGroups.length > 0) {
      return `brief puts a ${group.label} in the scene but the chapter only supports: ${chapterGroups.map((g) => g.label).join(', ')}`;
    }
  }
  return null;
}

/**
 * Build the illustration brief from the ACTUAL generated chapter prose (not
 * the pre-written outline synopsis) so the artwork depicts what the page says.
 *
 * A cheap, low-token LLM call picks the single most visual moment of the
 * chapter and describes it the way an illustrator needs: who is in the scene
 * (with their look), what they are doing, and where they are. If the LLM call
 * fails or times out we fall back to the chapter's most drawable sentences so
 * illustration generation never blocks the pipeline.
 */
export async function buildIllustrationBrief(
  content: string,
  chapterTitle: string,
  targetAudience: string,
  characterNames?: string[]
): Promise<string> {
  const excerpt = selectChapterExcerpt(content);
  const ageLine =
    targetAudience === '0-5'
      ? 'Keep the scene very simple: one clear action, one setting, minimal props.'
      : 'Keep the scene focused: one clear focal moment.';
  const cast = (characterNames ?? []).filter((n) => n.trim().length > 0).slice(0, 4);
  const castLine = cast.length > 0 ? `\nSeries characters: ${cast.join(', ')}.` : '';

  const systemPrompt = `You are the art-brief writer for a children's picture book. Given a finished chapter, pick the single most important, most visual moment and describe it as ONE scene for an illustrator (40-70 words).

Rules:
- Say who is in the scene (use their names and describe their look — hair, clothing, colors), what they are doing, and where they are.
- For EVERY character, state plainly WHAT they are, not just their name: "Victoria, a girl about seven with curly red hair…", "Biscuit, a fluffy brown puppy…". The illustrator has never met these characters — a bare name tells them nothing, and a pet described by name alone will be drawn as the wrong animal.
- Only include characters who actually appear in this chapter, exactly as the text describes them (species, age, outfit). Never swap one animal for another.
- The moment MUST be something that actually happens in this chapter text — never invent a scene that is not there.
- Write only what a camera could see: visible actions, visible objects, visible setting. No feelings, no thoughts, no backstory.
- Present tense, concrete visual details only. ${ageLine}

Describe ONLY the scene itself. Never mention "illustration", "picture", "art", "style", "3D", "render", "image", or camera/photography terms. Output only the scene description, no preamble.`;
  const userPrompt = `Chapter title: "${chapterTitle}"${castLine}\n\nChapter text:\n${excerpt}`;

  try {
    const briefCall = askLLMWithFallback(systemPrompt, userPrompt, 0.4, 220);
    // If the timeout wins the race, the provider call keeps running in the
    // background — swallow its eventual rejection so it cannot surface as an
    // unhandled promise rejection.
    briefCall.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutCall = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Illustration brief timed out')), 60_000);
    });

    try {
      const raw = (await Promise.race([briefCall, timeoutCall])).trim();
      const cleaned = sanitizeBrief(raw);
      if (cleaned.length >= 30) {
        // Grounding gate: a brief whose animal contradicts the chapter (page
        // says dog, brief says kitten) must never reach the artist — discard
        // it and fall back to the chapter's own most drawable sentences.
        const contradiction = findBriefContradiction(cleaned, content);
        if (contradiction) {
          console.warn(`[Illustration] Rejecting brief for "${chapterTitle}" — ${contradiction}. Using heuristic excerpt.`);
        } else {
          console.log(`[Illustration] Visual brief for "${chapterTitle}": ${cleaned.slice(0, 120)}...`);
          return cleaned.slice(0, 480);
        }
      } else {
        console.warn(`[Illustration] Visual brief too short (${cleaned.length} chars), using heuristic excerpt`);
      }
    } finally {
      // Always clear the timer: a pending 60s timer keeps the event loop (and
      // a serverless invocation) alive long after the brief is done.
      if (timer) clearTimeout(timer);
    }
  } catch (e) {
    console.warn(
      '[Illustration] Visual brief LLM call failed, using heuristic excerpt:',
      e instanceof Error ? e.message : e
    );
  }

  // Heuristic fallback: the most drawable beats of the chapter itself — still
  // derived from the real prose, never the outline synopsis.
  const fallback = pickVisualSentences(content, 2);
  console.log(`[Illustration] Using heuristic brief: ${fallback.slice(0, 120)}...`);
  return fallback.slice(0, 300);
}
