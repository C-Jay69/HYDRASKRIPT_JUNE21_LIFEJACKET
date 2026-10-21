// HydraSkript - Pure PDF Renderer
// Renders ExportableBook objects into PDFKit documents entirely in memory.
//
// This module is intentionally dependency-free beyond pdfkit/axios/node builtins
// so it can be used from the export service, tests, and preview scripts without
// pulling in storage or database side effects.
//
// Children's books get a storybook layout inspired by modern picture-book apps:
// full-bleed illustration with a wavy bottom edge, a "Chapter One" pill chip, a
// big rounded orange title, cream paper, and a drop cap on the opening text.

import PDFDocument from 'pdfkit';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

// ─── Page Geometry ────────────────────────────────────────────────────────────

const PAGE_WIDTH = 595.28; // A4 width in points
const PAGE_HEIGHT = 841.89; // A4 height in points
const MARGIN = 50;

// ─── Storybook Palette ────────────────────────────────────────────────────────

const CREAM = '#FFF6E3'; // warm paper
const PEACH = '#FDE8C8'; // illustration placeholder
const ORANGE = '#F2762E'; // title / drop cap
const INK = '#4A3B32'; // warm dark-brown body text
const CHIP_BG = '#7C5CFF'; // playful violet pill
const MUTED = '#C4A98C'; // footer dots / running heads

// ─── Embedded Fonts ───────────────────────────────────────────────────────────
// Rounded, kid-friendly faces committed under src/lib/fonts (Fredoka for titles,
// Nunito for body). If the TTFs cannot be found at runtime the renderer falls
// back to standard PDF fonts so export never hard-fails.

interface FontSpec {
  file: string[];
  fallback: string;
}

const STORY_FONTS: Record<string, FontSpec> = {
  'story-title': { file: ['Fredoka_700Bold.ttf'], fallback: 'Helvetica-Bold' },
  'story-title-semi': { file: ['Fredoka_600SemiBold.ttf'], fallback: 'Helvetica-Bold' },
  'story-body': { file: ['Nunito_400Regular.ttf'], fallback: 'Helvetica' },
  'story-body-bold': { file: ['Nunito_700Bold.ttf'], fallback: 'Helvetica-Bold' },
  'story-body-xbold': { file: ['Nunito_800ExtraBold.ttf'], fallback: 'Helvetica-Bold' },
};

function resolveFontBuffer(fileName: string): Buffer | null {
  const roots = [
    path.join(process.cwd(), 'src', 'lib', 'fonts'),
    path.join(process.cwd(), 'lib', 'fonts'),
    path.join(__dirname, 'fonts'),
    path.join(__dirname, '..', 'lib', 'fonts'),
    path.join(process.cwd(), 'public', 'fonts'),
  ];
  for (const root of roots) {
    try {
      const p = path.join(root, fileName);
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      // keep trying other roots
    }
  }
  return null;
}

/**
 * Register the storybook fonts on the document. Returns a lookup of logical
 * name -> PDFKit font name to use with doc.font(...).
 */
function registerStoryFonts(doc: PDFKit.PDFDocument): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [name, spec] of Object.entries(STORY_FONTS)) {
    let registered = false;
    for (const fileName of spec.file) {
      const buffer = resolveFontBuffer(fileName);
      if (buffer) {
        try {
          doc.registerFont(name, buffer);
          resolved[name] = name;
          registered = true;
          break;
        } catch (e) {
          console.warn(`[pdfRenderer] Failed to register font ${fileName}:`, e);
        }
      }
    }
    if (!registered) {
      resolved[name] = spec.fallback;
    }
  }
  return resolved;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal shape of a book needed to render a PDF. The real Prisma `book`
 * returned by getBookWithChapters satisfies this structurally.
 */
export interface ExportableBook {
  title: string;
  targetAudience: string;
  genre: string;
  coverImageUrl?: string | null;
  status?: string;
  chapters: {
    index: number;
    title?: string | null;
    content?: string | null;
    illustrationUrl?: string | null;
  }[];
}

/**
 * Fetch an image as a Buffer for PDFKit. Accepts http(s) URLs, data: URIs, and
 * local file paths (used by the preview script / tests).
 */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      if (comma === -1) return null;
      const meta = url.slice(0, comma);
      const payload = url.slice(comma + 1);
      return meta.includes(';base64')
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');
    }
    if (url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)) {
      return fs.readFileSync(url);
    }
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (e) {
    console.error(`[pdfRenderer] Failed to fetch image ${url}:`, e);
    return null;
  }
}

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** "1" -> "One", "21" -> "Twenty-One" (for "Chapter One" chips). */
export function chapterNumberWord(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return String(n);
  const num = Math.floor(n);
  if (num < 20) return ONES[num];
  if (num < 100) {
    const t = Math.floor(num / 10);
    const o = num % 10;
    return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
  }
  return String(num);
}

// ─── Storybook Decorations ────────────────────────────────────────────────────

/**
 * Cream-filled wave that overlaps the bottom of the illustration so the image
 * appears to end in a soft wavy edge (like a picture-book app reader).
 */
function drawWavyEdge(doc: PDFKit.PDFDocument, waveY: number, amp: number, fillTo: number): void {
  doc.save();
  doc.moveTo(0, waveY);
  const segments = 7;
  const w = PAGE_WIDTH / segments;
  for (let i = 0; i < segments; i++) {
    const x0 = i * w;
    const dir = i % 2 === 0 ? 1 : -1;
    doc.bezierCurveTo(
      x0 + w * 0.3, waveY + dir * amp,
      x0 + w * 0.7, waveY + dir * amp,
      x0 + w, waveY
    );
  }
  doc.lineTo(PAGE_WIDTH, fillTo);
  doc.lineTo(0, fillTo);
  doc.closePath();
  doc.fill(CREAM);
  doc.restore();
}

/** Small pill chip, e.g. "Chapter One". Returns the chip width used. */
function drawPillChip(
  doc: PDFKit.PDFDocument,
  fonts: Record<string, string>,
  label: string,
  centerX: number,
  topY: number
): void {
  const fontName = fonts['story-body-xbold'];
  doc.font(fontName).fontSize(12);
  const textW = doc.widthOfString(label);
  const chipW = textW + 40;
  const chipH = 30;
  const x = centerX - chipW / 2;
  doc.roundedRect(x, topY, chipW, chipH, chipH / 2).fill(CHIP_BG);
  const lineH = doc.currentLineHeight();
  doc.fillColor('#FFFFFF').text(label, x, topY + (chipH - lineH) / 2, {
    width: chipW,
    align: 'center',
    lineBreak: false,
  });
  doc.fillColor(INK);
}

/** Tiny decorative dots flanking the footer page number. */
function drawFooterDots(doc: PDFKit.PDFDocument, y: number): void {
  doc.save();
  doc.fillOpacity(0.85).fillColor(MUTED);
  for (const side of [-1, 1]) {
    for (let i = 1; i <= 3; i++) {
      doc.circle(PAGE_WIDTH / 2 + side * (22 + i * 9), y, i === 3 ? 1.1 : 1.7).fill();
    }
  }
  doc.restore();
  doc.fillColor(INK);
}

function drawIllustrationPlaceholder(doc: PDFKit.PDFDocument, fonts: Record<string, string>, y: number, height: number): void {
  doc.save();
  doc.roundedRect(MARGIN / 2, y + 10, PAGE_WIDTH - MARGIN, height - 20, 18).fill(PEACH);
  // simple sun + hills motif so an empty slot still feels storybook-ish
  doc.fillOpacity(0.9).fillColor('#F7C873').circle(PAGE_WIDTH - 130, y + 74, 26).fill();
  doc.fillOpacity(1).fillColor('#F2B268')
    .moveTo(40, y + height - 22)
    .quadraticCurveTo(PAGE_WIDTH * 0.3, y + height - 92, PAGE_WIDTH * 0.55, y + height - 22)
    .lineTo(PAGE_WIDTH * 0.55, y + height)
    .lineTo(40, y + height)
    .closePath()
    .fill();
  doc.font(fonts['story-title-semi']).fontSize(13).fillColor('#C9925B');
  doc.text('Illustration', 0, y + height / 2 - 8, { width: PAGE_WIDTH, align: 'center' });
  doc.restore();
  doc.fillColor(INK);
}

// ─── Text Measurement / Drop-Cap Layout ───────────────────────────────────────

interface BodyStyle {
  bodyFont: string;
  bodySize: number;
  lineGap: number;
  dropFont: string;
}

function lineAdvanceOf(doc: PDFKit.PDFDocument, style: BodyStyle): number {
  doc.font(style.bodyFont).fontSize(style.bodySize);
  return doc.currentLineHeight() + style.lineGap;
}

function dropCapMetrics(doc: PDFKit.PDFDocument, style: BodyStyle): { dropSize: number; dropW: number; besideW: number; besideLines: number } {
  const advance = lineAdvanceOf(doc, style);
  const besideLines = 3;
  const dropSize = Math.round(advance * besideLines * 0.74);
  doc.font(style.dropFont).fontSize(dropSize);
  // measure with a representative capital; actual letter is measured later
  const dropW = Math.max(doc.widthOfString('M') * 0.72, dropSize * 0.42);
  return { dropSize, dropW, besideW: 0, besideLines };
}

/** Greedy word-wrap with source offsets, using the document's current font metrics. */
interface WrappedLine {
  text: string;
  /** offset in the source string just past this line's last word */
  end: number;
}

function wrapLinesWithOffsets(doc: PDFKit.PDFDocument, text: string, width: number): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let line = '';
  let lineEnd = 0;
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    const candidate = line ? `${line} ${word}` : word;
    if (!line || doc.widthOfString(candidate) <= width) {
      line = candidate;
      lineEnd = m.index + word.length;
    } else {
      lines.push({ text: line, end: lineEnd });
      line = word;
      lineEnd = m.index + word.length;
    }
  }
  if (line) lines.push({ text: line, end: lineEnd });
  return lines;
}

/**
 * Height of a text block rendered by drawBodyWithDropCap() — used to split
 * chapters into page-sized chunks before drawing.
 */
function measureBlockHeight(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  style: BodyStyle,
  withDropCap: boolean
): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const advance = lineAdvanceOf(doc, style);
  if (!withDropCap) {
    doc.font(style.bodyFont).fontSize(style.bodySize);
    return doc.heightOfString(trimmed, { width, lineGap: style.lineGap });
  }
  const first = trimmed[0];
  const rest = trimmed.slice(1).trimStart();
  const metrics = dropCapMetrics(doc, style);
  const dropW = (() => {
    doc.font(style.dropFont).fontSize(metrics.dropSize);
    return doc.widthOfString(first);
  })();
  const besideW = Math.max(width - dropW - 12, width * 0.55);
  doc.font(style.bodyFont).fontSize(style.bodySize);
  const lines = wrapLinesWithOffsets(doc, rest, besideW);
  const besideCount = Math.min(metrics.besideLines, lines.length);
  const consumedEnd = besideCount > 0 ? lines[besideCount - 1].end : 0;
  const remaining = rest.slice(consumedEnd).trimStart();
  let h = besideCount * advance;
  if (remaining) {
    h += doc.heightOfString(remaining, { width, lineGap: style.lineGap });
  }
  return h;
}

/**
 * Draw body text with a large decorative drop cap on the first letter.
 * Assumes the text block was pre-chunked to fit the available height.
 */
function drawBodyWithDropCap(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  style: BodyStyle,
  withDropCap: boolean
): number {
  const trimmed = text.trim();
  if (!trimmed) return y;
  const advance = lineAdvanceOf(doc, style);

  if (!withDropCap) {
    doc.font(style.bodyFont).fontSize(style.bodySize).fillColor(INK);
    doc.text(trimmed, x, y, { width, align: 'left', lineGap: style.lineGap });
    return y + doc.heightOfString(trimmed, { width, lineGap: style.lineGap });
  }

  const first = trimmed[0];
  const rest = trimmed.slice(1).trimStart();
  const metrics = dropCapMetrics(doc, style);

  // Drop cap letter (orange, chunky)
  doc.font(style.dropFont).fontSize(metrics.dropSize).fillColor(ORANGE);
  const dropW = doc.widthOfString(first);
  const dropBaselineY = y - (metrics.dropSize - style.bodySize) * 0.16;
  doc.text(first, x, dropBaselineY, { lineBreak: false });

  const besideW = Math.max(width - dropW - 12, width * 0.55);
  doc.font(style.bodyFont).fontSize(style.bodySize).fillColor(INK);
  const lines = wrapLinesWithOffsets(doc, rest, besideW);
  const besideCount = Math.min(metrics.besideLines, lines.length);

  for (let i = 0; i < besideCount; i++) {
    doc.text(lines[i].text, x + dropW + 12, y + i * advance, { lineBreak: false });
  }

  const consumedEnd = besideCount > 0 ? lines[besideCount - 1].end : 0;
  const remaining = rest.slice(consumedEnd).trimStart();
  let cursorY = y + besideCount * advance;
  if (remaining) {
    doc.text(remaining, x, cursorY, { width, align: 'left', lineGap: style.lineGap });
    cursorY += doc.heightOfString(remaining, { width, lineGap: style.lineGap });
  }
  return cursorY;
}

/**
 * Split text into page-sized chunks. `withDropCap` applies to the FIRST chunk
 * only (the drop cap lives on the opening of the chapter).
 */
function chunkTextToFit(
  doc: PDFKit.PDFDocument,
  text: string,
  width: number,
  firstAvail: number,
  laterAvail: number,
  style: BodyStyle
): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  let avail = firstAvail;
  let isFirst = true;

  while (remaining.length > 0 && chunks.length < 24) {
    if (measureBlockHeight(doc, remaining, width, style, isFirst) <= avail) {
      chunks.push(remaining);
      break;
    }
    // split at sentence boundaries
    const parts: string[] = remaining.match(/[^.!?]+[.!?]+["')\]]*\s*/g) ?? [];
    if (parts.join('').length < remaining.length) {
      parts.push(remaining.slice(parts.join('').length));
    }
    let fit = '';
    let splitAt = -1;
    for (let i = 0; i < parts.length; i++) {
      const candidate = fit + parts[i];
      if (measureBlockHeight(doc, candidate, width, style, isFirst) <= avail) {
        fit = candidate;
        splitAt = i;
      } else {
        break;
      }
    }
    if (splitAt === -1) {
      // One sentence is taller than the whole page: hard-split by words.
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      let hard = '';
      let hardEnd = 0;
      while ((m = re.exec(remaining)) !== null) {
        const candidate = hard ? `${hard} ${m[0]}` : m[0];
        if (measureBlockHeight(doc, candidate, width, style, isFirst) <= avail) {
          hard = candidate;
          hardEnd = m.index + m[0].length;
        } else {
          break;
        }
      }
      if (!hard) break; // give up rather than loop forever
      chunks.push(hard);
      remaining = remaining.slice(hardEnd).trimStart();
    } else {
      chunks.push(fit.trim());
      remaining = remaining.slice(fit.length).trimStart();
    }
    isFirst = false;
    avail = laterAvail;
  }
  return chunks;
}

// ─── Page Compositions ────────────────────────────────────────────────────────

function drawFallbackCover(doc: PDFKit.PDFDocument, title: string): void {
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill('#111');
  doc
    .fillColor('#fff')
    .fontSize(32)
    .text(title || 'Untitled', MARGIN, PAGE_HEIGHT / 2 - 40, {
      width: PAGE_WIDTH - MARGIN * 2,
      align: 'center',
    });
  doc.fillColor('#999').fontSize(14).text('HydraSkript', MARGIN, PAGE_HEIGHT - 80, {
    width: PAGE_WIDTH - MARGIN * 2,
    align: 'center',
  });
}

interface ChildrenLayout {
  imageH: number;
  bodySize: number;
  lineGap: number;
  titleSize: number;
}

function layoutForAudience(targetAudience: string): ChildrenLayout {
  switch (targetAudience) {
    case '0-5':
      return { imageH: 388, bodySize: 15.5, lineGap: 5.5, titleSize: 30 };
    case '10-14':
      return { imageH: 286, bodySize: 11.5, lineGap: 3.8, titleSize: 24 };
    default: // 6-9 and anything else
      return { imageH: 336, bodySize: 13, lineGap: 4.6, titleSize: 27 };
  }
}

async function drawChildrenChapterPage(
  doc: PDFKit.PDFDocument,
  fonts: Record<string, string>,
  chapter: ExportableBook['chapters'][number],
  chunk: string,
  opts: {
    layout: ChildrenLayout;
    withDropCap: boolean;
    chapterLabel: string;
    isContinuation: boolean;
  }
): Promise<void> {
  const { layout, withDropCap, chapterLabel, isContinuation } = opts;
  const contentX = 58;
  const contentW = PAGE_WIDTH - 116;

  doc.addPage();
  doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT).fill(CREAM);

  if (!isContinuation) {
    // ── Illustration with wavy bottom edge ──
    const imageH = layout.imageH;
    const waveY = imageH - 26;
    if (chapter.illustrationUrl) {
      const img = await fetchImageBuffer(chapter.illustrationUrl);
      if (img) {
        try {
          doc.image(img, 0, 0, { cover: [PAGE_WIDTH, imageH], align: 'center', valign: 'center' });
        } catch (e) {
          console.error('[pdfRenderer] Failed to embed illustration:', e);
          drawIllustrationPlaceholder(doc, fonts, 0, imageH);
        }
      } else {
        drawIllustrationPlaceholder(doc, fonts, 0, imageH);
      }
    } else {
      drawIllustrationPlaceholder(doc, fonts, 0, imageH);
    }
    drawWavyEdge(doc, waveY, 11, imageH);

    // ── "Chapter One" pill chip ──
    const chipTop = imageH + 20;
    drawPillChip(doc, fonts, chapterLabel, PAGE_WIDTH / 2, chipTop);

    // ── Big rounded orange title ──
    const titleTop = chipTop + 30 + 12;
    doc.font(fonts['story-title']).fontSize(layout.titleSize).fillColor(ORANGE);
    const title = (chapter.title || '').trim() || chapterLabel;
    const titleH = doc.heightOfString(title, { width: contentW });
    doc.text(title, contentX, titleTop, { width: contentW, align: 'center', lineGap: 2 });

    // ── Body with drop cap ──
    const bodyTop = titleTop + titleH + 16;
    const bodyAvail = PAGE_HEIGHT - 76 - bodyTop;
    drawBodyWithDropCap(doc, chunk, contentX, bodyTop, contentW, {
      bodyFont: fonts['story-body'],
      bodySize: layout.bodySize,
      lineGap: layout.lineGap,
      dropFont: fonts['story-title'],
    }, withDropCap && chunk.trim().length > 0);
  } else {
    // ── Continuation page: running head + flowing text ──
    const headY = 64;
    const runningHead = (chapter.title || '').trim() || chapterLabel;
    doc.font(fonts['story-title-semi']).fontSize(14).fillColor(ORANGE);
    doc.text(runningHead, contentX, headY, { width: contentW, align: 'center', lineBreak: false });
    doc.font(fonts['story-body']).fontSize(10).fillColor(MUTED);
    doc.text('continued', contentX, headY + 20, { width: contentW, align: 'center', lineBreak: false });

    const bodyTop = headY + 44;
    drawBodyWithDropCap(doc, chunk, contentX, bodyTop, contentW, {
      bodyFont: fonts['story-body'],
      bodySize: layout.bodySize,
      lineGap: layout.lineGap,
      dropFont: fonts['story-title'],
    }, false);
  }
}

// ─── Full Document Render ─────────────────────────────────────────────────────

/**
 * Render the full PDF document into a single in-memory Buffer.
 * No filesystem writes — safe on read-only serverless filesystems.
 */
export async function renderPDF(book: ExportableBook): Promise<{ buffer: Buffer; pageCount: number }> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    autoFirstPage: false,
    bufferPages: true,
  });

  const fonts = registerStoryFonts(doc);
  const isChildrenBook = ['0-5', '6-9', '10-14'].includes(book.targetAudience);
  const isColoringBook = book.genre === 'coloring';

  const pdfBufferPromise = new Promise<Buffer>((resolve, reject) => {
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });

  // 1. Cover Page
  doc.addPage();
  if (book.coverImageUrl) {
    const imageBuffer = await fetchImageBuffer(book.coverImageUrl);
    if (imageBuffer) {
      try {
        doc.image(imageBuffer, 0, 0, { width: PAGE_WIDTH, height: PAGE_HEIGHT });
      } catch (e) {
        console.error('[pdfRenderer] Failed to embed cover:', e);
        drawFallbackCover(doc, book.title);
      }
    } else {
      drawFallbackCover(doc, book.title);
    }
  } else {
    drawFallbackCover(doc, book.title);
  }

  // 2. Chapters (copy first to avoid mutating the relation array)
  const chapters = book.chapters.slice().sort((a, b) => a.index - b.index);

  for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
    const chapter = chapters[chapterIndex];

    if (isColoringBook) {
      // COLORING BOOK: Full page image, no text
      doc.addPage();
      if (chapter.illustrationUrl) {
        const img = await fetchImageBuffer(chapter.illustrationUrl);
        if (img) {
          try {
            doc.image(img, MARGIN, MARGIN, {
              width: PAGE_WIDTH - MARGIN * 2,
              fit: [PAGE_WIDTH - MARGIN * 2, PAGE_HEIGHT - MARGIN * 2],
            });
          } catch (e) {
            console.error('[pdfRenderer] Failed to embed coloring page:', e);
          }
        }
      }
    } else if (isChildrenBook) {
      // CHILDREN'S BOOK: Storybook layout — illustration, wavy edge, chip,
      // big orange title, drop cap, cream paper.
      const layout = layoutForAudience(book.targetAudience);
      const style: BodyStyle = {
        bodyFont: fonts['story-body'],
        bodySize: layout.bodySize,
        lineGap: layout.lineGap,
        dropFont: fonts['story-title'],
      };
      const contentX = 58;
      const contentW = PAGE_WIDTH - 116;
      const chapterLabel = `Chapter ${chapterNumberWord(chapter.index + 1)}`;

      // Text regions for chunking (must match drawChildrenChapterPage math)
      const chipTop = layout.imageH + 20;
      const titleTop = chipTop + 30 + 12;
      doc.font(fonts['story-title']).fontSize(layout.titleSize);
      const title = (chapter.title || '').trim() || chapterLabel;
      const titleH = doc.heightOfString(title, { width: contentW });
      const firstBodyTop = titleTop + titleH + 16;
      const firstAvail = PAGE_HEIGHT - 76 - firstBodyTop;
      const laterAvail = PAGE_HEIGHT - 76 - (64 + 44);

      const chunks = chunkTextToFit(doc, chapter.content || '', contentW, firstAvail, laterAvail, style);

      if (chunks.length === 0) {
        await drawChildrenChapterPage(doc, fonts, chapter, '', {
          layout,
          withDropCap: false,
          chapterLabel,
          isContinuation: false,
        });
      }
      for (let i = 0; i < chunks.length; i++) {
        await drawChildrenChapterPage(doc, fonts, chapter, chunks[i], {
          layout,
          withDropCap: i === 0,
          chapterLabel,
          isContinuation: i > 0,
        });
      }
    } else {
      // ADULT BOOK: Standard professional layout
      doc.addPage();
      doc.fillColor('#000').fontSize(22).text(
        `Chapter ${chapter.index + 1}: ${chapter.title}`,
        { align: 'left' }
      );
      doc.moveDown();
      doc.fontSize(12).text(chapter.content || '', { align: 'justify', lineGap: 2 });
    }
  }

  // 3. Footers (need the total page count, so drawn last via page buffering).
  // NOTE: footer text must start INSIDE the margin box (y + line height <=
  // PAGE_HEIGHT - MARGIN) or PDFKit spawns an extra page per footer.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (i === 0) continue; // no footer on the cover
    drawFooterDots(doc, PAGE_HEIGHT - 60);
    doc.font(fonts['story-body-bold']).fontSize(10).fillColor(MUTED);
    doc.text(String(i), 0, PAGE_HEIGHT - 66, { width: PAGE_WIDTH, align: 'center', lineBreak: false });
    doc.fillColor(INK);
  }

  // Finalize the PDF document — this triggers the 'end' event above.
  doc.end();

  const pdfBuffer = await pdfBufferPromise;

  if (!pdfBuffer || pdfBuffer.length === 0) {
    throw new Error('Generated PDF is empty');
  }

  return { buffer: pdfBuffer, pageCount: range.count };
}
