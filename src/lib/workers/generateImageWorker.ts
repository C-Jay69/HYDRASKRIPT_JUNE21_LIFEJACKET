// HydraSkript - Image Generation Worker
// Handles the generation of book covers and chapter illustrations with tiered fallback

import { db } from '@/lib/db';
import { jobQueue } from '@/lib/workers/queue';
import { generateBookCover, generateChapterIllustration, generateColoringPage } from '@/lib/services/imageService';
import { buildIllustrationBrief } from '@/lib/services/illustrationBrief';
import { AUDIENCE_CONFIG, type ColoringTheme, type TargetAudience } from '@/types';

export async function generateImageWorker(jobId: string, assetParams: {
  bookId: string,
  ownerId: string,
  type: 'cover' | 'illustration' | 'coloring_page',
  chapterIndex?: number,
  prompt?: string,
  genre?: string,
  targetAudience?: string,
  coloringTheme?: string | null
}) {
  const { bookId, ownerId, type, chapterIndex, prompt, genre, targetAudience, coloringTheme } = assetParams;

  try {
    await jobQueue.heartbeat(jobId);
    let result;
    let illustrationPrompt: string | undefined;

    if (type === 'cover') {
      // Look up the actual book title rather than passing the hardcoded placeholder
      const bookRecord = await db.book.findUnique({ where: { id: bookId }, select: { title: true } });
      const bookTitle = bookRecord?.title || 'Untitled';
      result = await generateBookCover(bookId, ownerId, bookTitle, genre || 'fiction', targetAudience || 'adult', coloringTheme);
    } else if (type === 'coloring_page') {
      if (chapterIndex === undefined) throw new Error('chapterIndex is required for coloring pages');
      // The synopsis is the art-director's visual brief for a coloring page; the
      // chapter content is poetic facing-page text that would push the model
      // toward a full-color scene. Prefer the synopsis.
      const chapter = await db.chapter.findFirst({ where: { bookId, index: chapterIndex } });
      const subject = chapter?.synopsis?.trim() || chapter?.content?.trim() || 'A beautiful scene';
      result = await generateColoringPage(bookId, ownerId, chapterIndex, subject, coloringTheme as ColoringTheme | null | undefined);
    } else {
      // Illustration. An explicit prompt wins; otherwise the scene is derived
      // from the chapter's own prose so the artwork matches the page instead
      // of falling back to a generic "cinematic scene".
      let targetPrompt = prompt?.trim();
      const chapter = await db.chapter.findFirst({ where: { bookId, index: chapterIndex || 0 } });
      // The cast lives on the book, not the chapter. The brief writer needs it
      // (to name the right characters and say what each one is) just as much
      // as the illustrator call does, so load it before both.
      const bookRecord = await db.book.findUnique({
        where: { id: bookId },
        select: { characterNames: true },
      });
      const characterNames = Array.isArray(bookRecord?.characterNames)
        ? (bookRecord!.characterNames as unknown[])
            .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
            .slice(0, 4)
        : undefined;
      if (!targetPrompt && chapter?.content?.trim()) {
        targetPrompt = await buildIllustrationBrief(
          chapter.content,
          chapter.title ?? '',
          targetAudience || '6-9',
          characterNames
        );
      }
      if (!targetPrompt) {
        targetPrompt = 'A cinematic scene from the story';
      }
      const style = targetAudience ? AUDIENCE_CONFIG[targetAudience as TargetAudience]?.illustrationStyle || 'pixar' : 'pixar';
      result = await generateChapterIllustration(bookId, ownerId, chapterIndex || 0, targetPrompt, style, characterNames);
      // Store the EXACT prompt the backend received (style tag + scene +
      // render vocabulary), not just the brief — that is what "what did the
      // artist actually get?" has to answer when a picture misses the page.
      illustrationPrompt = result.prompt ?? targetPrompt;
    }

    if (!result.success) {
      throw new Error(`Image generation failed: ${result.error}`);
    }

    await jobQueue.heartbeat(jobId);

    // Update the database to link the image to the asset
    if (type === 'cover') {
      await db.book.update({ where: { id: bookId }, data: { coverImageUrl: result.publicUrl } });
    } else {
      // Find the chapter by index and update its illustrationUrl
      const chapter = await db.chapter.findFirst({ where: { bookId, index: chapterIndex } });
      if (chapter) {
        await db.chapter.update({
          where: { id: chapter.id },
          // The prompt that produced the art is stored on the chapter so the
          // artwork can always be traced back to the scene it was drawn from.
          data: {
            illustrationUrl: result.publicUrl,
            ...(illustrationPrompt ? { illustrationPrompt } : {}),
          }
        });
      }
    }

    console.log(`[ImageWorker] Successfully generated ${type} for book ${bookId}`);

  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ImageWorker] Failed to generate ${type}:`, errMessage);
    throw error;
  }
}
