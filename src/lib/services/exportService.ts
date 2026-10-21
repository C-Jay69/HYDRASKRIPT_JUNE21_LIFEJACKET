// HydraSkript - Professional Export Service
// Generates production-ready PDF exports of completed books.
//
// The actual PDF layout lives in ./pdfRenderer (pure, in-memory). This module
// handles the export workflow: loading the book, validating it, streaming the
// bytes to the caller, and persisting a copy to storage when available.

import { saveFile, generateFilename, createMediaAsset } from '@/lib/utils/storage';
import { getBookWithChapters, isBookExportable } from '@/lib/utils/bookHelpers';
import { renderPDF } from '@/lib/services/pdfRenderer';

// ─── PDF Export ────────────────────────────────────────────────────────────────

export interface ExportBufferResult {
  success: boolean;
  buffer?: Buffer;
  contentType?: string;
  filename?: string;
  pageCount?: number;
  error?: string;
}

/**
 * Generate the PDF bytes for a completed book without touching the filesystem.
 * Used by the download route to stream the file directly — this works on
 * read-only serverless filesystems (e.g. AWS Lambda `/var/task`) where no
 * local write is permitted and no external storage may be configured.
 */
export async function generatePDFBuffer(
  bookId: string,
  ownerId: string
): Promise<ExportBufferResult> {
  const book = await getBookWithChapters(bookId, ownerId);

  if (!book) return { success: false, error: 'Book not found' };
  const exportable = isBookExportable(book);
  if (!exportable.ok) return { success: false, error: exportable.error };

  try {
    const { buffer, pageCount } = await renderPDF(book);
    return {
      success: true,
      buffer,
      pageCount,
      contentType: 'application/pdf',
      filename: generateFilename(`book_${bookId}`, 'pdf'),
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[ExportService] PDF render failed:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Generate a professional PDF for a completed book and persist it to storage
 * (Cloudflare R2 / Supabase / local disk).
 *
 * Persistence is best-effort: when no external storage is configured and the
 * local filesystem is read-only (serverless), the export still reports success
 * so the caller can deliver the file via generatePDFBuffer() streaming.
 */
export async function exportBookAsPDF(
  bookId: string,
  ownerId: string
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  const generated = await generatePDFBuffer(bookId, ownerId);

  if (!generated.success || !generated.buffer) {
    return { success: false, error: generated.error || 'Failed to generate PDF' };
  }

  const buffer = generated.buffer;

  try {
    // Save to storage
    const filename = generated.filename || generateFilename(`book_${bookId}`, 'pdf');
    const publicUrl = await saveFile('pdfs', filename, buffer, {
      contentType: 'application/pdf',
    });

    await createMediaAsset({
      ownerId,
      bookId,
      assetType: 'pdf_export',
      storagePath: publicUrl,
      publicUrl,
      metadata: { format: 'pdf', pages: generated.pageCount ?? 0 },
    });

    return {
      success: true,
      publicUrl: `${publicUrl}?download=true`,
    };
  } catch (error) {
    // Storage unavailable (e.g. read-only serverless filesystem with no R2 or
    // Supabase configured). Not fatal — the download route streams the PDF
    // directly from memory instead.
    const errMessage = error instanceof Error ? error.message : String(error);
    console.warn('[ExportService] PDF generated but not persisted (will stream on download):', errMessage);
    return { success: true };
  }
}

export async function exportBookAsHTML(bookId: string, ownerId: string) {
  // Now redirects to professional PDF export
  return exportBookAsPDF(bookId, ownerId);
}
