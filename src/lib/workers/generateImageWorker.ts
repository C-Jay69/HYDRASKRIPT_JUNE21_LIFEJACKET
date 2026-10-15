// HydraSkript - Image Generation Worker
// Handles the generation of book covers and chapter illustrations with tiered fallback

import { db } from '@/lib/db';
import { jobQueue } from '@/lib/workers/queue';
import { generateBookCover, generateChapterIllustration, generateColoringPage } from '@/lib/services/imageService';
import { buildKidsIllustrationPrompt, isKidsAudience } from '@/lib/utils/kidsBook';
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

    if (type === 'cover') {
      // Look up the actual book title rather than passing the hardcoded placeholder
      const bookRecord = await db.book.findUnique({
        where: { id: bookId },
        select: { title: true, adventureType: true, characterNames: true, description: true },
      });
      const bookTitle = bookRecord?.title || 'Untitled';
      result = await generateBookCover(bookId, ownerId, bookTitle, genre || 'fiction', targetAudience || 'adult', coloringTheme, {
        adventureType: bookRecord?.adventureType,
        characterNames: Array.isArray(bookRecord?.characterNames) ? (bookRecord!.characterNames as string[]) : [],
        description: bookRecord?.description,
      });
    } else if (type === 'coloring_page') {
      if (chapterIndex === undefined) throw new Error('chapterIndex is required for coloring pages');
      // The synopsis is the art-director's visual brief for a coloring page; the
      // chapter content is poetic facing-page text that would push the model
      // toward a full-color scene. Prefer the synopsis.
      const chapter = await db.chapter.findFirst({ where: { bookId, index: chapterIndex } });
      const subject = chapter?.synopsis?.trim() || chapter?.content?.trim() || 'A beautiful scene';
      result = await generateColoringPage(bookId, ownerId, chapterIndex, subject, coloringTheme as ColoringTheme | null | undefined);
    } else {
      // Illustration
      const style = targetAudience ? AUDIENCE_CONFIG[targetAudience as TargetAudience]?.illustrationStyle || 'pixar' : 'pixar';
      let targetPrompt = prompt || 'A cinematic scene from the story';
      if (isKidsAudience(targetAudience)) {
        // Kids books: anchor the hero/friends + adventure setting and scrub the
        // outline sentinel token so it never reaches the image model.
        const bookRecord = await db.book.findUnique({
          where: { id: bookId },
          select: { title: true, adventureType: true, characterNames: true },
        });
        targetPrompt = buildKidsIllustrationPrompt({
          scene: targetPrompt,
          audience: targetAudience as TargetAudience,
          adventureType: bookRecord?.adventureType,
          characterNames: Array.isArray(bookRecord?.characterNames) ? (bookRecord!.characterNames as string[]) : [],
          bookTitle: bookRecord?.title,
        });
      }
      result = await generateChapterIllustration(bookId, ownerId, chapterIndex || 0, targetPrompt, style);
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
          data: { illustrationUrl: result.publicUrl }
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
