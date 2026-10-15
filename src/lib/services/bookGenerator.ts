// HydraSkript - Book Generator Service (Interactive Studio Version)
import { db } from '@/lib/db';
import { jobQueue } from '@/lib/workers/queue';
import { reserveCredits, consumeCredits, refundCredits, refundOutstandingReservation, estimateBookCredits, estimateColoringBookCredits, getBookDefaults } from '@/lib/utils/credits';
import { askLLMJSONWithFallback, askLLMWithFallback } from '@/lib/llm/fallback';
import { getOutlinePrompt, getOutlineUserPrompt, getChapterWritePrompt, getChapterUserPrompt, getChildrensChapterPrompt, getColoringOutlinePrompt, getColoringOutlineUserPrompt, getColoringChapterPrompt } from '@/lib/llm/prompts';
import { BookOutlineSchema, validateOrThrow } from '@/lib/llm/schema';
import { generateBookCover, generateChapterIllustration, generateColoringPage } from '@/lib/services/imageService';
import { buildKidsIllustrationPrompt, getAdventureToken, stripAdventureToken } from '@/lib/utils/kidsBook';
import { getStyleSystemPrompt } from '@/lib/services/styleAnalyzer';
import { assembleBooksManuscript, enqueueEditorialReview } from '@/lib/services/editorialReview';
import { extractEntitiesFromManuscript } from '@/lib/story-bible-extraction';
import type { TargetAudience, Genre, ColoringTheme } from '@/types';
import { AUDIENCE_CONFIG, COLORING_THEMES } from '@/types';

/**
 * Normalize raw chapter prose from the LLM into clean content.
 * Handles the common cases where a small model still wraps output in JSON or
 * markdown fences, or prepends a redundant title line.
 */
function cleanChapterText(raw: string, chapterTitle: string): string {
  let text = raw.trim();

  // Strip markdown code fences if the model added them anyway
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();

  // If it came back as JSON, try to recover the chapter text from it
  if (text.startsWith('{')) {
    // 1) Valid JSON with a usable content field — ideal case
    try {
      const parsed = JSON.parse(text) as { content?: unknown };
      if (typeof parsed.content === 'string' && parsed.content.trim().length >= 50) {
        return parsed.content.trim();
      }
    } catch {
      // malformed JSON — fall through to extraction below
    }

    // 2) Malformed JSON (e.g. {"content":"title", "Chapter 1...", "prose..."}).
    //    Grab the longest quoted string — that is almost always the real prose.
    const quoted = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      m[1].replace(/\\"/g, '"')
    );
    const longest = quoted
      .filter((s) => s.trim().length >= 50)
      .sort((a, b) => b.length - a.length)[0];
    if (longest) return longest.trim();

    // 3) Last resort: strip the outer braces/brackets and use what's left
    const stripped = text.replace(/^[\[{]+/, '').replace(/[\]}]+$/, '').trim();
    if (stripped.length >= 50) return stripped;
  }

  // Plain prose: drop a leading line that is just the chapter title (redundant with UI)
  const lines = text.split(/\r?\n/);
  if (
    lines.length > 1 &&
    lines[0].trim().toLowerCase() === chapterTitle.trim().toLowerCase()
  ) {
    text = lines.slice(1).join('\n').trim();
  }

  return text;
}

/**
 * Initial entry point to start the book generation process.
 * Now only handles credit reservation and triggers the Outline phase.
 */
export async function startBookGeneration(
  bookId: string,
  ownerId: string
): Promise<{ jobId: string; estimatedCredits: number } | { error: string }> {
  const book = await db.book.findUnique({
    where: { id: bookId, ownerId },
    include: { styleProfile: true },
  });

  if (!book) return { error: 'Book not found' };
  if (['outlining', 'writing', 'finalizing'].includes(book.status)) {
    return { error: 'Book is already in a generation state' };
  }

  const defaults = getBookDefaults(book.targetAudience as TargetAudience);
  const isChildrenBook = ['0-5', '6-9', '10-14'].includes(book.targetAudience);
  const isColoringBook = book.genre === 'coloring';
  const coloringTheme = book.coloringTheme as ColoringTheme | null;

  let chapterCount = book.chapterCount || defaults.chapterCount;
  try {
    const existingOutline = JSON.parse(book.outline || '{}');
    if (existingOutline.requestedChapters) chapterCount = existingOutline.requestedChapters;
  } catch {}

  let estimatedCredits: number;
  if (isColoringBook) {
    estimatedCredits = estimateColoringBookCredits(chapterCount, coloringTheme);
  } else {
    estimatedCredits = estimateBookCredits(
      book.targetAudience as TargetAudience,
      chapterCount,
      defaults.wordsPerChapter,
      isChildrenBook,
      false
    );
  }

  const jobId = await jobQueue.createJob({
    bookId,
    ownerId,
    jobType: 'generate_outline',
    creditsReserved: estimatedCredits,
    stepIndex: 0,
  });

  const reserved = await reserveCredits(ownerId, estimatedCredits, jobId, 'Book generation estimate');
  if (!reserved) {
    await jobQueue.updateJobStatus(jobId, {
      status: 'failed',
      errorMessage: 'Insufficient credits',
      progressMessage: 'Failed: Insufficient credits',
    });
    await db.job.update({ where: { id: jobId }, data: { creditsReserved: 0 } });
    return { error: 'Insufficient credits.' };
  }

  await db.book.update({
    where: { id: bookId },
    data: { status: 'outlining', totalCreditsEstimated: estimatedCredits },
  });

  // Trigger the outline generation via the queue
  await jobQueue.startJob(jobId, 'generate_outline');

  return { jobId, estimatedCredits };
}

/**
 * PHASE 1: Outline Generation
 * Generates the story blueprint and stops for user approval.
 */
export async function generateOutline(bookId: string, ownerId: string, jobId: string): Promise<void> {
  console.log(`[DEBUG] 1. generateOutline started for bookId: ${bookId}`);
  
  const book = await db.book.findUnique({
    where: { id: bookId },
    include: { styleProfile: true },
  });

  if (!book) {
    console.log(`[DEBUG] X. Book not found!`);
    throw new Error('Book not found');
  }

  try {
    console.log(`[DEBUG] 2. Updating job status to 10%...`);
    await jobQueue.updateJobStatus(jobId, { progressMessage: 'Generating story blueprint...', progressPercent: 10 });

    console.log(`[DEBUG] 3. Getting style system prompt...`);
    const stylePrompt = await getStyleSystemPrompt(book.styleProfileId);
    
    const targetAudience = book.targetAudience as TargetAudience;
    const genre = book.genre as Genre;
    const config = AUDIENCE_CONFIG[targetAudience];
    const coloringTheme = book.coloringTheme as ColoringTheme | null;

    // Use the user-selected chapter count; fall back to the audience default.
    let chapterCount = book.chapterCount || config.defaultChapters;
    try {
      const existingOutline = JSON.parse(book.outline || '{}');
      if (existingOutline.requestedChapters) chapterCount = existingOutline.requestedChapters;
    } catch {}

    let outlinePrompt: string;
    let outlineUser: string;

    if (genre === 'coloring' && coloringTheme && COLORING_THEMES[coloringTheme]) {
      outlinePrompt = getColoringOutlinePrompt(coloringTheme, chapterCount, targetAudience);
      outlineUser = getColoringOutlineUserPrompt(book.title, coloringTheme, targetAudience);
    } else {
      console.log(`[DEBUG] 4. Parsing character names...`);
      // characterNames is Postgres String[] — Prisma returns a JS array directly, never a JSON string
      const characterNames: string[] = Array.isArray(book.characterNames)
        ? (book.characterNames as string[])
        : [];

      outlinePrompt = getOutlinePrompt(genre, targetAudience, chapterCount, stylePrompt, characterNames.length > 0 ? characterNames : undefined, book.adventureType ?? undefined, book.description ?? undefined);
      outlineUser = getOutlineUserPrompt(book.title, genre, targetAudience);
    }

    console.log(`[DEBUG] 5. Calling askLLMJSONWithFallback (waiting for AI response...)`);
    const outlineResult = await askLLMJSONWithFallback<unknown>(outlinePrompt, outlineUser, 0.7);
    
    console.log(`[DEBUG] 6. AI responded! Validating schema...`);
    const outline = validateOrThrow(BookOutlineSchema, outlineResult);

    // Adventure-setting compliance check. The outliner is asked to prefix every
    // synopsis with a sentinel token so we can measure whether it honoured the
    // setting. The token is a *marker*, not story content: once measured we
    // strip it from titles and synopses so it never leaks into the outline
    // editor, the chapter-writing prompt, the illustration prompt, or the PDF.
    if (book.adventureType) {
        const adventureToken = getAdventureToken(book.adventureType).toUpperCase();
        let missing = 0;
        for (const chapter of outline.chapters) {
          const titleHasToken = chapter.title?.toUpperCase().includes(adventureToken) ?? false;
          const synopsisHasToken = chapter.synopsis?.toUpperCase().includes(adventureToken) ?? false;
          if (!titleHasToken && !synopsisHasToken) missing++;
          chapter.title = stripAdventureToken(chapter.title) || chapter.title;
          chapter.synopsis = stripAdventureToken(chapter.synopsis);
        }
        if (missing > 0) {
          console.warn(`[Outline Validation] ${missing}/${outline.chapters.length} chapter(s) omitted the adventure token for "${book.adventureType}". Setting is still enforced in the chapter prompt.`);
        }
    }

    console.log(`[DEBUG] 7. Saving outline to database...`);
    await db.book.update({
      where: { id: bookId },
      data: {
        outline: JSON.stringify(outline),
        status: 'awaiting_outline_approval'
      }
    });

    console.log(`[DEBUG] 8. Initializing empty chapters...`);
    for (let i = 0; i < outline.chapters.length; i++) {
      const ch = outline.chapters[i];
      await db.chapter.upsert({
        where: { bookId_index: { bookId, index: i } },
        create: { bookId, index: i, title: ch.title, synopsis: ch.synopsis, wordTarget: ch.wordTarget, status: 'pending', generationJobId: jobId },
        update: { title: ch.title, synopsis: ch.synopsis, wordTarget: ch.wordTarget, status: 'pending', generationJobId: jobId },
      });
    }

    console.log(`[DEBUG] 9. Outline complete! Updating job to 100%`);
    await jobQueue.updateJobStatus(jobId, {
      status: 'completed',
      progressMessage: 'Blueprint complete! Please review and approve your outline.',
      progressPercent: 100
    });

  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error("[Queue] OUTLINE GENERATION FAILED:", errMessage);
    await db.book.update({ where: { id: bookId }, data: { status: 'failed' } });
    await refundCredits(jobId, `Outline failed: ${errMessage}`);
    await jobQueue.updateJobStatus(jobId, { status: 'failed', errorMessage: errMessage, progressMessage: `Failed: ${errMessage}` });
    throw error;
  }
}

/**
 * PHASE 2: Iterative Chapter Generation
 * Writes a single chapter and stops for user approval.
 */
export async function generateChapter(bookId: string, ownerId: string, jobId: string, chapterIndex: number): Promise<void> {
  const book = await db.book.findUnique({
    where: { id: bookId },
    include: { styleProfile: true },
  });

  if (!book) throw new Error('Book not found');

  // Detect "auto-approve all chapters" mode. When set, each chapter is approved
  // immediately and the worker chains straight into the next pending chapter so a
  // single action completes the entire book without stopping for review.
  let autoApprove = false;
  try {
    const job = await db.job.findUnique({ where: { id: jobId } });
    const result = job?.result ? JSON.parse(job.result) : {};
    autoApprove = result.autoApprove === true;
  } catch {}

  try {
    await jobQueue.updateJobStatus(jobId, { progressMessage: `Writing chapter ${chapterIndex + 1}...`, progressPercent: 20 });

    // Mark chapter as 'writing' immediately so the UI shows progress
    // instead of leaving it as 'pending' during the long LLM call.
    await db.chapter.update({
      where: { bookId_index: { bookId, index: chapterIndex } },
      data: { status: 'writing' },
    });

    // Continuity: gather summaries from the last few chapters (not just the
    // previous one) so the model knows who has actually been introduced so
    // far. Each summaryForNext is a short fallback excerpt, so chaining 2-3
    // of them preserves the cast + plot thread far better than one alone.
    const prevChapters = await db.chapter.findMany({
      where: { bookId, index: { lt: chapterIndex } },
      orderBy: { index: 'desc' },
      take: 3,
    });
    const previousSummary = prevChapters.length > 0
      ? [...prevChapters].reverse()
          .map((c) => `Ch ${c.index + 1} (${c.title}): ${c.summaryForNext || 'no summary'}`)
          .join('\n')
      : 'This is the beginning of the story.';

    const stylePrompt = await getStyleSystemPrompt(book.styleProfileId);
    const targetAudience = book.targetAudience as TargetAudience;
    const genre = book.genre as Genre;
    const isChildrenBook = ['0-5', '6-9', '10-14'].includes(targetAudience);
    const isColoringBook = genre === 'coloring';
    const coloringTheme = book.coloringTheme as ColoringTheme | null;
    const config = AUDIENCE_CONFIG[targetAudience];

    const chapter = await db.chapter.findUnique({
      where: { bookId_index: { bookId, index: chapterIndex } },
    });

    if (!chapter) throw new Error(`Chapter ${chapterIndex} not found`);

    // Resolve totalChapters from the outline JSON, fall back to DB count.
    // Also build a compact full-outline string so the chapter model knows the
    // whole arc (which characters belong in which chapter) instead of only
    // seeing its own synopsis.
    let totalChapters = 0;
    let fullOutline = '';
    try {
      const outlineData = JSON.parse(book.outline || '{}');
      totalChapters = outlineData?.chapters?.length ?? 0;
      if (Array.isArray(outlineData?.chapters)) {
        fullOutline = outlineData.chapters
          .map((c: { title?: string; synopsis?: string }, i: number) => `Ch ${i + 1} "${c.title ?? ''}": ${c.synopsis ?? ''}`)
          .join('\n');
      }
    } catch {}
    if (totalChapters === 0) {
      totalChapters = await db.chapter.count({ where: { bookId } });
    }

    let fullSystemPrompt: string;
    let chapterUser: string;

    if (isColoringBook && coloringTheme && COLORING_THEMES[coloringTheme]) {
      fullSystemPrompt = getColoringChapterPrompt(coloringTheme, chapterIndex, totalChapters, targetAudience);
      chapterUser = `Write a brief, age-appropriate description for the coloring page titled "${chapter.title}". Visual subject: ${chapter.synopsis}.`;
    } else {
      // characterNames is Postgres String[] — Prisma returns a JS array directly, never a JSON string
      const characterNames: string[] = Array.isArray(book.characterNames)
        ? (book.characterNames as string[])
        : [];

      // Defensive: older books may still carry the sentinel token in stored synopses.
      const cleanSynopsis = stripAdventureToken(chapter.synopsis) || chapter.synopsis;
      const chapterPrompt = getChapterWritePrompt(stylePrompt, book.title, genre, chapterIndex, totalChapters, previousSummary, characterNames.length > 0 ? characterNames : undefined, {
        description: book.description ?? undefined,
        fullOutline: stripAdventureToken(fullOutline) || undefined,
        currentSynopsis: `${chapter.title}: ${cleanSynopsis}`,
        adventureType: book.adventureType ?? undefined,
      });
      const childrensPrompt = isChildrenBook ? getChildrensChapterPrompt(targetAudience) : '';
      fullSystemPrompt = childrensPrompt ? `${childrensPrompt}\n\n${chapterPrompt}` : chapterPrompt;
      chapterUser = getChapterUserPrompt(chapter.title, cleanSynopsis, chapter.wordTarget);
    }

    // Per-chapter timeout: 10 minutes max for the entire LLM call chain.
    // Prevents the triple-redundancy fallback from hanging for 2+ hours.
    const CHAPTER_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const llmCall = askLLMWithFallback(fullSystemPrompt, chapterUser, 0.7, 8192);
    const timeoutCall = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Chapter generation timed out after ${CHAPTER_TIMEOUT_MS / 1000}s — all LLM providers may be unreachable`)), CHAPTER_TIMEOUT_MS)
    );
    const rawText = (await Promise.race([llmCall, timeoutCall])).trim();
    if (rawText.length < 50) {
      throw new Error(`Chapter generation returned insufficient content (${rawText.length} chars)`);
    }

    const content = cleanChapterText(rawText, chapter.title);
    const chapterResult = {
      content,
      charactersIntroduced: [] as string[],
      summaryForNextChapter: '',
    };

    // If the model omitted the continuity summary, derive one from the chapter
    // itself. Capture the opening (who/where is established) plus the ending
    // (where the plot left off) so the next chapter inherits the cast, not
    // just the final hook.
    let summaryForNext = chapterResult.summaryForNextChapter;
    if (!summaryForNext || summaryForNext.length < 10) {
      const sentences = chapterResult.content.match(/[^.!?]+[.!?]+/g) ?? [];
      const opening = sentences.slice(0, 1).join(' ').trim();
      const ending = sentences.slice(-2).join(' ').trim();
      const combined = [opening, ending].filter(Boolean).join(' ').trim();
      summaryForNext = (combined || chapterResult.content.slice(-300)).slice(0, 600);
    }

    await db.chapter.update({
      where: { id: chapter.id },
      data: {
        content: chapterResult.content,
        wordCount: chapterResult.content.split(/\s+/).length,
        charactersIntroduced: JSON.stringify(chapterResult.charactersIntroduced),
        summaryForNext,
        status: 'awaiting_approval', // New state for interactive steering
      },
    });

    // Handle Illustrations
    if (isChildrenBook && !isColoringBook) {
      try {
        const kidsCast: string[] = Array.isArray(book.characterNames) ? (book.characterNames as string[]) : [];
        const illustrationPrompt = buildKidsIllustrationPrompt({
          scene: chapter.synopsis || chapter.title,
          audience: targetAudience,
          adventureType: book.adventureType,
          characterNames: kidsCast,
          bookTitle: book.title,
        });
        // Cast anchoring is already baked into the prompt above; don't pass names
        // again or the consistency preamble would be duplicated.
        const illustration = await generateChapterIllustration(bookId, ownerId, chapterIndex, illustrationPrompt, config.illustrationStyle);
        if (illustration.success && illustration.publicUrl) {
          await db.chapter.update({ where: { id: chapter.id }, data: { illustrationUrl: illustration.publicUrl, illustrationPrompt } });
        }
      } catch (e) { console.error('Illustration failed', e); }
    } else if (isColoringBook) {
      try {
        // For coloring books the synopsis is the art-director's visual brief; the
        // chapter "content" is poetic facing-page text that mentions colors/mood
        // and pushes the image model toward a full-color scene. Prefer the synopsis.
        const coloringSubject = chapter.synopsis?.trim() || chapterResult.content?.trim();
        const coloringPage = await generateColoringPage(bookId, ownerId, chapterIndex, coloringSubject, coloringTheme, targetAudience);
        if (coloringPage.success && coloringPage.publicUrl) {
          await db.chapter.update({ where: { id: chapter.id }, data: { illustrationUrl: coloringPage.publicUrl } });
        }
      } catch (e) { console.error('Coloring page failed', e); }
    }

    // Auto-approve mode: accept this chapter and chain straight into the next one
    if (autoApprove) {
      await db.chapter.update({
        where: { id: chapter.id },
        data: { approvalStatus: 'approved', status: 'completed' },
      });

      const nextPendingChapter = await db.chapter.findFirst({
        where: { bookId, status: 'pending' },
        orderBy: { index: 'asc' },
      });

      if (nextPendingChapter) {
        const nextJobId = await jobQueue.createJob({
          bookId,
          ownerId,
          jobType: 'write_chapter',
          creditsReserved: 0,
          stepIndex: nextPendingChapter.index,
          result: JSON.stringify({ autoApprove: true }),
        });
        await jobQueue.startJob(nextJobId, 'write_chapter');
        console.log(`[GenerateChapter] Auto-approved chapter ${chapter.index + 1}. Chaining to chapter ${nextPendingChapter.index + 1}.`);
      } else {
        const bookWithCredits = await db.book.findUnique({ where: { id: bookId } });
        const totalCredits = bookWithCredits?.totalCreditsEstimated || 0;

        const finalizeJobId = await jobQueue.createJob({
          bookId,
          ownerId,
          jobType: 'finalize_book',
          creditsReserved: 0,
          creditsConsumed: totalCredits,
        });
        await jobQueue.startJob(finalizeJobId, 'finalize_book');

        await db.book.update({ where: { id: bookId }, data: { status: 'finalizing' } });
        console.log(`[GenerateChapter] All chapters auto-approved. Starting finalization.`);
      }
    }

    await jobQueue.updateJobStatus(jobId, {
      status: 'completed',
      progressMessage: autoApprove
        ? `Chapter ${chapterIndex + 1} completed.`
        : `Chapter ${chapterIndex + 1} drafted! Please review and approve.`,
      progressPercent: 100
    });

  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error("[Queue] CHAPTER GENERATION FAILED:", errMessage); // <-- ADDED LOGGING HERE
    await db.chapter.update({
      where: { bookId_index: { bookId, index: chapterIndex } },
      data: { status: 'failed' }
    });
    await jobQueue.updateJobStatus(jobId, { status: 'failed', errorMessage: errMessage, progressMessage: `Failed: ${errMessage}` });
    await refundOutstandingReservation(bookId, `Chapter generation failed: ${errMessage}`);
    throw error;
  }
}

/**
 * PHASE 3.5: Auto Story Bible & Universe population
 * After the book is fully written, extract its lore (characters, locations,
 * objects, themes, history) from the manuscript and persist Story Bible
 * entities for this book. The Universe & Series Architect reads these entities
 * across every book, so populating the Story Bible automatically feeds the
 * Universe view as well. Best-effort: failures are logged but never block
 * finalization.
 */
async function generateStoryBibleFromBook(bookId: string, ownerId: string): Promise<void> {
  try {
    const book = await db.book.findUnique({
      where: { id: bookId },
      include: { chapters: { orderBy: { index: 'asc' } } },
    });
    if (!book) return;

    // Assemble a manuscript from the outline + every written chapter.
    const parts: string[] = [`# ${book.title}`];
    if (book.description) parts.push(book.description);
    try {
      const outline = JSON.parse(book.outline || '{}');
      if (Array.isArray(outline.chapters)) {
        for (const ch of outline.chapters) {
          parts.push(`\n## ${ch.title}\n${ch.synopsis ?? ''}`);
        }
      }
    } catch {}
    for (const ch of book.chapters ?? []) {
      if (ch.content && ch.content.trim().length > 50) {
        parts.push(`\n## ${ch.title}\n${ch.content}`);
      }
    }

    const manuscript = parts.join('\n').replace(/\u0000/g, '').trim();
    if (!manuscript || manuscript.length < 200) {
      console.log(`[StoryBible] Book ${bookId} has too little content to auto-populate. Skipping.`);
      return;
    }

    // Mine the ENTIRE book (not just the opening chapters): the extractor
    // walks the manuscript in overlapping windows, asks the LLM for new
    // entities per window, and merges/dedupes the results.
    const extraction = await extractEntitiesFromManuscript(manuscript);
    for (const warning of extraction.warnings) {
      console.warn(`[StoryBible] Book ${bookId}: ${warning}`);
    }
    if (extraction.windowsFailed > 0) {
      console.warn(
        `[StoryBible] Book ${bookId}: ${extraction.windowsFailed}/${extraction.windows} manuscript portion(s) failed during auto-population (continuing with what was extracted).`
      );
    }
    // Skip entities that already exist for this book (idempotent re-runs).
    const existing = await db.storyBibleEntity.findMany({
      where: { bookId },
      select: { kind: true, name: true },
    });
    const seen = new Set(existing.map((e) => `${e.kind}:${e.name.toLowerCase().trim()}`));

    const toCreate = extraction.entities
      .filter((e) => e.name && e.name.trim())
      .filter((e) => !seen.has(`${e.kind}:${e.name.toLowerCase().trim()}`))
      .map((e) => ({
        ownerId,
        bookId,
        kind: e.kind,
        name: e.name.trim(),
        role: e.role ?? '',
        summary: e.summary ?? '',
        motivation: e.motivation ?? '',
        description: e.description ?? '',
        physicalTraits: JSON.stringify({ tags: e.tags ?? [], notes: '' }),
        secrets: JSON.stringify({ confidential: e.secret ?? '', isPrivate: true }),
      }));

    if (toCreate.length === 0) {
      console.log(`[StoryBible] No new entities to create for book ${bookId}.`);
      return;
    }

    await db.storyBibleEntity.createMany({ data: toCreate });
    console.log(`[StoryBible] Auto-created ${toCreate.length} Story Bible entities for book ${bookId}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[StoryBible] Auto-population failed (non-fatal):', msg);
  }
}

/**
 * PHASE 3: Final Assembly
 * Completes the book, generates the cover, and charges credits.
 */
export async function finalizeBook(bookId: string, ownerId: string, jobId: string, totalCredits: number): Promise<void> {
  const book = await db.book.findUnique({
    where: { id: bookId },
  });

  if (!book) throw new Error('Book not found');

  try {
    await jobQueue.updateJobStatus(jobId, { progressMessage: 'Finalizing your book...', progressPercent: 10 });

    const targetAudience = book.targetAudience as TargetAudience;
    const genre = book.genre as Genre;
    const isChildrenBook = ['0-5', '6-9', '10-14'].includes(targetAudience);
    const isColoringBook = genre === 'coloring';
    const coloringTheme = book.coloringTheme as ColoringTheme | null;

    // Cover Art
    if (isChildrenBook || isColoringBook || !book.coverImageUrl) {
      await jobQueue.updateJobStatus(jobId, { progressMessage: 'Creating cover art...', progressPercent: 50 });
      const coverResult = await generateBookCover(bookId, ownerId, book.title, genre, targetAudience, coloringTheme, {
        adventureType: book.adventureType,
        characterNames: Array.isArray(book.characterNames) ? (book.characterNames as string[]) : [],
        description: book.description,
      });
      if (coverResult.success && coverResult.publicUrl) {
        await db.book.update({ where: { id: bookId }, data: { coverImageUrl: coverResult.publicUrl } });
      }
    }

    await db.book.update({
      where: { id: bookId },
      data: {
        status: 'completed',
        totalCreditsCharged: totalCredits
      }
    });

    // Auto-populate the Story Bible (and therefore the Universe) for this book
    // from the finished manuscript. Non-fatal — never blocks completion.
    await generateStoryBibleFromBook(bookId, ownerId);

    // Auto-populate the Universe (Editorial Review) for this generated book
    // from the finished manuscript. Non-fatal — never blocks completion.
    try {
      const manuscript = await assembleBooksManuscript([bookId], ownerId);
      if (manuscript && manuscript.trim().length > 0) {
        await enqueueEditorialReview({
          ownerId,
          bookId,
          scope: 'book',
          sourceLabel: book.title,
          sourceText: manuscript,
        });
        console.log(`[Universe] Auto-enqueued editorial review for book ${bookId}`);
      }
    } catch (e) {
      console.error('[Universe] Auto-review enqueue failed (non-fatal):', e);
    }

    // Settle the escrow reservation against the actual cost.
    // The estimate was deducted at generation start; reconcile any difference.
    const outlineJob = await db.job.findFirst({
      where: { bookId, jobType: 'generate_outline', creditsReserved: { gt: 0 } },
      select: { id: true },
    });
    if (outlineJob) {
      await consumeCredits(ownerId, totalCredits, outlineJob.id, 'Book generation completed');
    } else {
      await consumeCredits(ownerId, totalCredits, jobId, 'Book generation completed');
    }
    await jobQueue.updateJobStatus(jobId, {
      status: 'completed',
      progressMessage: 'Book completed! Your masterpiece is ready.',
      progressPercent: 100,
      completedAt: new Date()
    });

  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error("[Queue] BOOK FINALIZATION FAILED:", errMessage); // <-- ADDED LOGGING HERE
    await db.book.update({ where: { id: bookId }, data: { status: 'failed' } });
    await refundCredits(jobId, `Finalization failed: ${errMessage}`);
    await refundOutstandingReservation(bookId, `Finalization failed: ${errMessage}`);
    await jobQueue.updateJobStatus(jobId, { status: 'failed', errorMessage: errMessage, progressMessage: `Failed: ${errMessage}` });
    throw error;
  }
}