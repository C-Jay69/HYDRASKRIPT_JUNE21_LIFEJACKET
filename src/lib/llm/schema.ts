// HydraSkript - Zod Schemas for Runtime Validation
// All structured outputs from LLM are validated through these schemas

import { z } from 'zod';

// ─── Outline Schema ───────────────────────────────────────────────────────────

export const OutlineChapterSchema = z.object({
  title: z.string().min(1, 'Chapter title is required'),
  synopsis: z.string().min(10, 'Synopsis must be at least 10 characters'),
  // Lower bound is 1 (not 50) because coloring-book outlines are instructed to
  // emit `wordTarget: 10` ("ignored for coloring books, but required by the
  // format"). Coerce so a model emitting "10" as a string still parses — a
  // strict number schema used to fail every coloring book here.
  wordTarget: z.coerce.number().int().min(1).max(5000),
});

export const BookOutlineSchema = z.object({
  title: z.string().min(1, 'Book title is required'),
  chapters: z.array(OutlineChapterSchema).min(1, 'Must have at least 1 chapter').max(100, 'Maximum 100 chapters'),
});

export type ValidatedOutline = z.infer<typeof BookOutlineSchema>;

// ─── Chapter Generation Schema ────────────────────────────────────────────────

export const ChapterGenerationSchema = z.object({
  content: z.string().min(50, 'Chapter content must be at least 50 characters'),
  charactersIntroduced: z.array(z.string()).catch([]),
  summaryForNextChapter: z.string().catch(''),
});

export type ValidatedChapter = z.infer<typeof ChapterGenerationSchema>;

// ─── Style Analysis Schema ────────────────────────────────────────────────────

export const StyleAnalysisSchema = z.object({
  systemPrompt: z.string().min(20, 'Style prompt must be at least 20 characters'),
});

export type ValidatedStyleAnalysis = z.infer<typeof StyleAnalysisSchema>;

// ─── Image Prompt Schema ──────────────────────────────────────────────────────

export const ImagePromptSchema = z.object({
  prompt: z.string().min(10, 'Image prompt must be at least 10 characters'),
  subject: z.string().min(3, 'Subject description required'),
});

export type ValidatedImagePrompt = z.infer<typeof ImagePromptSchema>;

// ─── Book Creation Schema ─────────────────────────────────────────────────────

export const CreateBookSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be under 200 characters'),
  genre: z.enum(['fiction', 'non-fiction', 'fantasy', 'sci-fi', 'mystery', 'romance', 'horror', 'children', 'young-adult', 'coloring', 'poetry', 'self-help', 'biography']),
  targetAudience: z.enum(['adult', '0-5', '6-9', '10-14']),
  coloringTheme: z.enum(['mandalas', 'undersea-creatures', 'birds', 'animals-of-the-wild', 'famous-landmarks', 'exotic-sports-cars', 'flowers-gardens', 'fantasy-dragons', 'zen-patterns', 'architectural-details', 'butterflies-insects', 'vintage-botanicals']).optional(),
  styleProfileId: z.string().optional(),
  chapterCount: z.number().int().min(1).max(100).optional(),
  adventureType: z.string().optional(),
  characterNames: z.array(z.string().max(50)).max(5).optional(),
});

export type CreateBookInput = z.infer<typeof CreateBookSchema>;

// ─── Style Profile Creation Schema ────────────────────────────────────────────

export const CreateStyleProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be under 100 characters'),
  description: z.string().max(1500, 'Description must be under 1500 characters').optional(),
  exemplarTexts: z.array(z.string().min(50, 'Each sample must be at least 50 characters')).min(1, 'At least 1 sample required').max(10, 'Maximum 10 samples'),
});

export type CreateStyleProfileInput = z.infer<typeof CreateStyleProfileSchema>;

// ─── Manuscript Import Schema ─────────────────────────────────────────────────

export const ManuscriptEntitySchema = z.object({
  kind: z.enum(['CHARACTER', 'LOCATION', 'OBJECT', 'THEME', 'HISTORY']),
  name: z.string().min(1, 'Name is required'),
  role: z.string().default(''),
  summary: z.string().default(''),
  motivation: z.string().default(''),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  // Hidden lore (plot secrets, later reveals). Optional — older model output
  // and cached results may not include it, in which case the field defaults
  // to an empty string.
  secret: z.string().default(''),
});

export const ManuscriptImportSchema = z.object({
  entities: z.array(ManuscriptEntitySchema).min(1, 'At least one entity required'),
});

export type ValidatedManuscriptImport = z.infer<typeof ManuscriptImportSchema>;

// ─── Editorial Review Schemas ────────────────────────────────────────────────

export const EDITORIAL_CATEGORIES = [
  'TIMELINE',
  'CHARACTER',
  'CONTINUITY',
  'CROSS_REFERENCE',
  'PLOT_HOLE',
  'LOCATION',
  'POV',
  'FACTUAL',
  'DIALOGUE',
  'OTHER',
] as const;

export const EDITORIAL_SEVERITIES = ['critical', 'warning', 'info'] as const;

export const EditorialFindingSchema = z.object({
  severity: z.enum(EDITORIAL_SEVERITIES).catch('warning'),
  category: z.enum(EDITORIAL_CATEGORIES).catch('OTHER'),
  title: z.string().min(1, 'Finding title is required').catch('Editorial note'),
  description: z.string().min(1, 'Finding description is required').catch('No description provided.'),
  quote: z.string().default(''),
  location: z.string().default(''),
  suggestion: z.string().default(''),
});

export const EditorialContinuityNoteSchema = z.object({
  entity: z.string().min(1, 'Entity name is required').catch('Unnamed'),
  category: z.enum(['PHYSICAL', 'RELATIONSHIP', 'TIMELINE', 'LOCATION', 'STATUS', 'OBJECT']).catch('STATUS'),
  fact: z.string().min(1, 'Fact is required').catch('No fact provided.'),
  location: z.string().default(''),
});

export const EditorialChunkResultSchema = z.object({
  findings: z.array(EditorialFindingSchema).default([]),
  continuity: z.array(EditorialContinuityNoteSchema).default([]),
});

export const EditorialCoherenceResultSchema = z.object({
  findings: z.array(EditorialFindingSchema).default([]),
});

export type ValidatedEditorialChunk = z.infer<typeof EditorialChunkResultSchema>;
export type ValidatedEditorialCoherence = z.infer<typeof EditorialCoherenceResultSchema>;
export type EditorialFinding = z.infer<typeof EditorialFindingSchema>;
export type EditorialContinuityNote = z.infer<typeof EditorialContinuityNoteSchema>;

// ─── Idea Transfer Schema ─────────────────────────────────────────────────────

export const IdeaTransferSchema = z.object({
  bookId: z.string().min(1, 'bookId is required'),
  ideaText: z.string().min(1, 'ideaText is required'),
  title: z.string().optional(),
  blurb: z.string().optional(),
  chapters: z.array(z.object({
    number: z.number(),
    title: z.string().min(1, 'Chapter title is required').catch('Untitled Chapter'),
    synopsis: z.string().optional().catch(''),
  })).optional(),
  coverConcept: z.string().optional(),
});

export type ValidatedIdeaTransfer = z.infer<typeof IdeaTransferSchema>;

// ─── Credit Purchase Schema ───────────────────────────────────────────────────

export const CreditPurchaseSchema = z.object({
  pricingKey: z.enum(['starter', 'author', 'publisher', 'studio', 'pack_100', 'pack_500', 'pack_1000']),
});

export type CreditPurchaseInput = z.infer<typeof CreditPurchaseSchema>;

// ─── Job Status Update Schema ─────────────────────────────────────────────────

export const JobStatusUpdateSchema = z.object({
  status: z.enum(['queued', 'active', 'completed', 'failed']),
  progressMessage: z.string().optional(),
  progressPercent: z.number().int().min(0).max(100).optional(),
  errorMessage: z.string().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});

// ─── Validation Helper ────────────────────────────────────────────────────────

export function validateOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Validation error: ${errors}`);
  }
  return result.data;
}
