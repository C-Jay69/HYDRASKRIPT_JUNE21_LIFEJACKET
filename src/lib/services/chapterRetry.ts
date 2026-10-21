// HydraSkript - Chapter Retry Service
// Recovery path for chapters stuck in `failed` while the book itself is still
// `writing` (or awaiting review). Without this, a single failed chapter is an
// unrecoverable dead end: the book-level Retry button only renders when the
// whole book status is `failed`, so there was no UI affordance to re-drive
// generation for just the failed chapter.
//
// Flow:
//   Chapter Failed -> Retry -> reset to pending -> new write_chapter job ->
//   Writing -> Review Needed -> Approve & Proceed

import { db } from '@/lib/db';
import { jobQueue } from '@/lib/workers/queue';

export async function retryFailedChapter(
  bookId: string,
  ownerId: string,
  chapterIndex: number
): Promise<{ jobId: string; chapterIndex: number }> {
  const book = await db.book.findUnique({
    where: { id: bookId, ownerId },
  });

  if (!book) {
    throw new Error('Book not found');
  }

  const chapter = await db.chapter.findUnique({
    where: { bookId_index: { bookId, index: chapterIndex } },
  });

  if (!chapter) {
    throw new Error(`Chapter ${chapterIndex + 1} not found`);
  }

  if (chapter.status !== 'failed') {
    throw new Error('Only failed chapters can be retried');
  }

  // Idempotency: if a driver job for this chapter is already queued/active
  // (e.g. double-click, or the queue pump's reconcile pass already re-queued
  // it), return the existing job instead of enqueueing a duplicate.
  const existingDriver = await db.job.findFirst({
    where: {
      bookId,
      jobType: 'write_chapter',
      status: { in: ['queued', 'active'] },
      stepIndex: chapterIndex,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (existingDriver) {
    // Make sure the chapter row reflects that work is in flight.
    await db.chapter.update({
      where: { bookId_index: { bookId, index: chapterIndex } },
      data: { status: 'writing' },
    });
    if (book.status !== 'writing') {
      await db.book.update({ where: { id: bookId }, data: { status: 'writing' } });
    }
    return { jobId: existingDriver.id, chapterIndex };
  }

  // Reset the chapter to a clean pending state. The worker overwrites content
  // on success; clearing here prevents stale partial content from rendering
  // as if it were a valid draft while the retry is in flight.
  //
  // The illustration is cleared with it: leaving the previous attempt's artwork
  // in place shows an image of the OLD text next to the NEW text, which is
  // exactly the "the picture doesn't match the page" complaint.
  await db.chapter.update({
    where: { bookId_index: { bookId, index: chapterIndex } },
    data: {
      status: 'pending',
      approvalStatus: 'pending',
      content: '',
      wordCount: 0,
      summaryForNext: '',
      illustrationUrl: null,
      illustrationPrompt: '',
    },
  });

  // Bring the book back into an actively-generating state so the progress UI
  // and the queue pump's reconcile pass treat it as in-flight work.
  if (book.status !== 'writing') {
    await db.book.update({ where: { id: bookId }, data: { status: 'writing' } });
  }

  const jobId = await jobQueue.createJob({
    bookId,
    ownerId,
    jobType: 'write_chapter',
    creditsReserved: 0, // covered by the book-level escrow at generation start
    stepIndex: chapterIndex,
  });

  await jobQueue.startJob(jobId, 'write_chapter');

  return { jobId, chapterIndex };
}
