// HydraSkript - Ideas Lab → Story Bible Transfer API
// POST /api/story-bible/transfer
// Carry generated Idea Lab output (title, blurb, outline) into a book's story bible
// as THEME + HISTORY entities, without creating a book automatically.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isUnauthorizedError, requireProfile, unauthorizedResponse } from '@/lib/api-auth';
import { assertBookOwnership, toDTO } from '@/lib/story-bible-helpers';
import { IdeaTransferSchema, validateOrThrow } from '@/lib/llm/schema';

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireProfile(request);

    const body = await request.json().catch(() => ({}));
    const input = validateOrThrow(IdeaTransferSchema, body);

    await assertBookOwnership(input.bookId, profile.id);

    const created: Awaited<ReturnType<typeof db.storyBibleEntity.create>>[] = [];

    const themeName = input.title?.trim() || 'Core Concept';
    const themeDescription = [
      input.blurb?.trim(),
      input.coverConcept?.trim(),
    ].filter(Boolean).join('\n\n');

    const theme = await db.storyBibleEntity.create({
      data: {
        ownerId: profile.id,
        bookId: input.bookId,
        kind: 'THEME',
        name: themeName,
        role: 'Core Concept',
        summary: input.ideaText.slice(0, 180),
        motivation: 'The central idea the story explores.',
        description: themeDescription || input.ideaText,
        physicalTraits: JSON.stringify({ tags: [], notes: '' }),
        secrets: JSON.stringify({ confidential: '', isPrivate: true }),
      },
    });
    created.push(theme);

    if (input.chapters && input.chapters.length > 0) {
      const history = await Promise.all(
        input.chapters.map((chapter) => {
          const synopsis = chapter.synopsis ?? '';
          return db.storyBibleEntity.create({
            data: {
              ownerId: profile.id,
              bookId: input.bookId,
              kind: 'HISTORY',
              name: `Chapter ${chapter.number}: ${chapter.title}`,
              role: 'Story Timeline',
              summary: synopsis.slice(0, 180),
              motivation: 'Plot event that shapes the story.',
              description: synopsis,
              physicalTraits: JSON.stringify({ tags: [], notes: '' }),
              secrets: JSON.stringify({ confidential: '', isPrivate: true }),
            },
          });
        })
      );
      created.push(...history);
    }

    console.log(`[API/story-bible/transfer] Carried ${created.length} entities into book ${input.bookId}`);

    return NextResponse.json({
      success: true,
      data: {
        entities: created.map(toDTO),
        total: created.length,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/story-bible/transfer] Failed:', message, error instanceof Error ? error.stack : '');
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
