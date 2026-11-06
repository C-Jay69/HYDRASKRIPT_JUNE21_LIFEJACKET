// HydraSkript - API Client
// Centralized API client for all frontend-to-backend communication

const API_BASE = '/api';

// ─── Fetch Helper ─────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<{ success: boolean; data?: T; error?: string }> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    // Check if response is JSON before parsing
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      // If it's HTML (login page), treat as auth failure
      if (text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
        console.warn(`[API Client] ${path} returned HTML (likely login redirect)`);
        return { success: false, error: 'Authentication required' };
      }
      return { success: false, error: `Unexpected response: ${text.slice(0, 100)}` };
    }

    const result = await response.json();
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[API DEBUG] ${path} →`, response.status, result);
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    console.error(`[API Client] ${path} failed:`, message);
    return { success: false, error: message };
  }
}

// ─── Profile API ──────────────────────────────────────────────────────────────

export interface ProfileData {
  id: string;
  email: string;
  name: string;
  credits: number;
  tier: string;
  isAdmin: boolean;
  founderBadge?: boolean;
  isLifetime?: boolean;
  createdAt: string;
}

export async function getProfile(): Promise<ProfileData | null> {
  const result = await apiFetch<ProfileData>('/profile');
  return result.success ? result.data ?? null : null;
}

export async function getUserEmail(): Promise<string | null> {
  const profile = await getProfile();
  return profile?.email ?? null;
}

export async function setUserEmail(_email: string) {
  return Promise.resolve();
}

export async function updateProfile(name: string) {
  return apiFetch<ProfileData>('/profile', {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

// ─── Books API ────────────────────────────────────────────────────────────────

export interface BookData {
  id: string;
  title: string;
  genre: string;
  targetAudience: string;
  status: string;
  coverImageUrl: string | null;
  totalCreditsEstimated: number;
  totalCreditsCharged: number;
  maxPages: number;
  styleProfileId: string | null;
  outline: string;
  chapters: ChapterData[];
  styleProfile?: { id: string; name: string };
  jobs?: JobData[];
  mediaAssets?: MediaAssetData[];
  createdAt: string;
  updatedAt: string;
}

export interface ChapterData {
  id: string;
  index: number;
  title: string;
  synopsis: string;
  wordTarget: number;
  content: string;
  wordCount: number;
  status: string;
  approvalStatus?: string;
  charactersIntroduced: string;
  summaryForNext: string;
  illustrationUrl: string | null;
  illustrationPrompt: string;
  generationJobId: string | null;
}

export interface MediaAssetData {
  id: string;
  assetType: string;
  publicUrl: string;
  metadata: string;
  createdAt: string;
}

export interface CreateBookInput {
  title: string;
  description?: string;
  genre: string;
  targetAudience: string;
  coloringTheme?: string;
  styleProfileId?: string;
  chapterCount?: number;
  adventureType?: string;
  characterNames?: string[];
}

export async function listBooks(): Promise<BookData[]> {
  const result = await apiFetch<BookData[]>('/books');
  return result.data ?? [];
}

export async function getBook(id: string): Promise<BookData | null> {
  const result = await apiFetch<BookData>(`/books/${id}`);
  return result.data ?? null;
}

export async function createBook(input: CreateBookInput) {
  return apiFetch<BookData>('/books', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteBook(id: string) {
  return apiFetch(`/books/${id}`, { method: 'DELETE' });
}

export async function startGeneration(bookId: string) {
  return apiFetch<{ jobId: string; estimatedCredits: number }>(
    `/books/${bookId}/generate`,
    { method: 'POST' }
  );
}

export async function exportBook(bookId: string, format: string = 'pdf') {
  return apiFetch<{ downloadUrl: string; format: string }>(`/books/${bookId}/export`, {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
}

export async function retryChapter(bookId: string, chapterIndex: number) {
  return apiFetch<{ jobId: string; chapterIndex: number }>(`/books/${bookId}/retry-chapter`, {
    method: 'POST',
    body: JSON.stringify({ chapterIndex }),
  });
}

// ─── Jobs API ─────────────────────────────────────────────────────────────────

export interface AudiobookTracker {
  segmentsDone: number;
  segmentsTotal: number | null;
  percentComplete: number;
  percentRemaining: number;
  elapsedSeconds: number;
  avgSecondsPerSegment: number | null;
  remainingSegments: number | null;
  remainingSeconds: number | null;
  etaUtc: string | null;
  currentChapterTitle: string | null;
  currentChunk: number | null;
  currentChapterChunks: number | null;
  chapterCount: number;
}

export interface JobData {
  id: string;
  jobType: string;
  status: string;
  progressMessage: string;
  progressPercent: number;
  creditsReserved: number;
  creditsConsumed: number;
  errorMessage: string | null;
  /** Transient-failure attempts so far / attempts allowed before the job fails. */
  retryCount: number;
  maxRetries: number;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  /** Audiobook jobs only: realtime percent/remaining/ETA while narrating. */
  tracker?: AudiobookTracker | null;
}

export async function getJob(jobId: string): Promise<JobData | null> {
  const result = await apiFetch<JobData>(`/jobs/${jobId}`);
  return result.data ?? null;
}

// ─── Credits API ──────────────────────────────────────────────────────────────

export interface CreditsData {
  credits: number;
  tier: string;
  founderCount?: number;
  recentTransactions: {
    id: string;
    amount: number;
    reason: string;
    createdAt: string;
  }[];
}

export async function getCredits(): Promise<CreditsData | null> {
  const result = await apiFetch<CreditsData>('/credits');
  return result.data ?? null;
}

export async function purchaseCredits(pricingKey: string) {
  return apiFetch<{ checkoutUrl: string; sessionId: string }>('/credits/checkout', {
    method: 'POST',
    body: JSON.stringify({ pricingKey }),
  });
}

// ─── Style Profiles API ──────────────────────────────────────────────────────

export interface StyleProfileData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  preview: string;
  exemplarTexts: string[];
  createdAt: string;
}

export async function listStyleProfiles(): Promise<StyleProfileData[]> {
  const result = await apiFetch<StyleProfileData[]>('/training/style-profile');
  return result.data ?? [];
}

export async function createStyleProfile(input: {
  name: string;
  description?: string;
  exemplarTexts: string[];
}) {
  return apiFetch('/training/style-profile', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteStyleProfile(profileId: string) {
  return apiFetch('/training/style-profile', {
    method: 'DELETE',
    body: JSON.stringify({ profileId }),
  });
}

// ─── Admin API ────────────────────────────────────────────────────────────────

export interface AdminData {
  analytics: {
    totalUsers: number;
    totalBooks: number;
    completedBooks: number;
    failedBooks: number;
    totalCreditsConsumed: number;
    jobStats: { queued: number; active: number; completed: number; failed: number };
  };
  jobs: {
    id: string;
    jobType: string;
    status: string;
    progressMessage: string;
    progressPercent: number;
    creditsReserved: number;
    creditsConsumed: number;
    errorMessage: string | null;
    book: { id: string; title: string } | null;
    owner: { id: string; email: string; name: string };
    createdAt: string;
    completedAt: string | null;
  }[];
}

export async function getAdminData(): Promise<AdminData | null> {
  const result = await apiFetch<AdminData>('/admin');
  return result.data ?? null;
}
// ─── Story Bible API ──────────────────────────────────────────────────────────

export type StoryBibleKind = 'CHARACTER' | 'LOCATION' | 'OBJECT' | 'THEME' | 'HISTORY';

export interface StoryBibleEntity {
  id: string;
  bookId: string;
  kind: StoryBibleKind;
  name: string;
  role: string;
  summary: string;
  motivation: string;
  description: string;
  physicalTraits: { tags: string[]; notes: string };
  secrets: { confidential: string; isPrivate: boolean };
  portraitUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StoryBiblePayload = Partial<
  Pick<
    StoryBibleEntity,
    'kind' | 'name' | 'role' | 'summary' | 'motivation' | 'description' | 'portraitUrl'
  >
> & {
  physicalTraits?: { tags: string[]; notes: string };
  secrets?: { confidential: string; isPrivate: boolean };
};

export async function listStoryBibleEntities(bookId: string, kind?: StoryBibleKind) {
  const query = kind ? `?bookId=${encodeURIComponent(bookId)}&kind=${kind}` : `?bookId=${encodeURIComponent(bookId)}`;
  return apiFetch<StoryBibleEntity[]>(`/story-bible${query}`);
}

export async function getStoryBibleEntity(id: string) {
  return apiFetch<StoryBibleEntity>(`/story-bible/${id}`);
}

export async function createStoryBibleEntity(bookId: string, payload: StoryBiblePayload) {
  return apiFetch<StoryBibleEntity>('/story-bible', {
    method: 'POST',
    body: JSON.stringify({ bookId, ...payload }),
  });
}

export async function updateStoryBibleEntity(id: string, payload: StoryBiblePayload) {
  return apiFetch<StoryBibleEntity>(`/story-bible/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteStoryBibleEntity(id: string) {
  return apiFetch<{ ok: true }>(`/story-bible/${id}`, { method: 'DELETE' });
}

export interface ManuscriptImportResult {
  fileName: string;
  entities: StoryBibleEntity[];
  counts: Record<string, number>;
  total: number;
  bookId?: string;
  /** Entities the AI found but skipped because they already exist for this book. */
  duplicatesSkipped?: number;
  /** Manuscript windows the AI could not analyze (flaky LLM calls). */
  portionsSkipped?: number;
  /** True when the manuscript was longer than the analysis budget. */
  truncated?: boolean;
  /** Story-bible sections (kinds) that still have no entries after the import. */
  emptyKinds?: StoryBibleKind[];
  /** Storage path of the original uploaded file (for reference). */
  storagePath?: string;
  /** Chapters persisted from the manuscript so the book can be exported. */
  chaptersSaved?: number;
}

export async function importManuscriptToStoryBible(
  bookId: string | null,
  file: File,
  onProgress?: (progress: { message?: string; percent?: number }) => void
) {
  const MAX_DIRECT_UPLOAD = 4 * 1024 * 1024; // 4 MB - Vercel serverless limit
  const MAX_PRESIGNED_UPLOAD = 25 * 1024 * 1024; // 25 MB - presigned URL limit

  if (file.size > MAX_PRESIGNED_UPLOAD) {
    return {
      success: false as const,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB — the maximum supported size is 25 MB. Try splitting the file or converting to .txt.`,
    };
  }

  // For files larger than 4 MB, use presigned URL upload to bypass Vercel's payload limit
  const usePresignedUrl = file.size > MAX_DIRECT_UPLOAD;

  let jobId: string;
  let fileName: string;
  let resolvedBookId: string;
  let newBookCreated: boolean;

  if (usePresignedUrl) {
    // Step 1: Get presigned upload URL
    const uploadUrlResponse = await fetch('/api/story-bible/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
      }),
    });

    const uploadUrlData = await uploadUrlResponse.json();
    if (!uploadUrlResponse.ok || !uploadUrlData.success) {
      return { success: false as const, error: uploadUrlData.error || 'Failed to get upload URL' };
    }

    const { uploadUrl, publicUrl, storagePath, storageProvider } = uploadUrlData.data;

    // Step 2: Upload file directly to storage
    let uploadResponse: Response;
    if (storageProvider === 'local') {
      // Local endpoint expects multipart/form-data
      const formData = new FormData();
      formData.append('file', file);
      if (bookId) formData.append('bookId', bookId);
      formData.append('storagePath', storagePath);
      uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });
    } else {
      // R2 presigned PUT — file goes in the body
      uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
    }

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      console.error('[importManuscriptToStoryBible] Storage upload failed:', errorText);
      return { success: false as const, error: 'Failed to upload file to storage. Please try again.' };
    }

    // Step 3: Call import endpoint with storage path
    const importResponse = await fetch('/api/story-bible/import-manuscript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bookId,
        storagePath,
        fileName: file.name,
        fileSize: file.size,
      }),
    });

    const importResult = await importResponse.json();
    if (!importResponse.ok || !importResult.success) {
      return { success: false as const, error: importResult.error || 'Import failed' };
    }

    jobId = importResult.data.jobId;
    fileName = importResult.data.fileName;
    resolvedBookId = importResult.data.bookId;
    newBookCreated = importResult.data.newBookCreated;
  } else {
    // Direct upload for small files (≤ 4 MB)
    const formData = new FormData();
    if (bookId) formData.append('bookId', bookId);
    formData.append('file', file);

    const response = await fetch('/api/story-bible/import-manuscript', {
      method: 'POST',
      body: formData,
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return { success: false as const, error: `Import failed (server error ${response.status}). Please try again.` };
    }

    const body = (await response.json()) as {
      success: boolean;
      data?: { jobId?: string; fileName?: string; bookId?: string; newBookCreated?: boolean };
      error?: string;
    };
    if (!response.ok || body.success !== true) {
      return { success: false as const, error: body.error || `Import failed (server error ${response.status}). Please try again.` };
    }

    if (!body.data?.jobId || !body.data?.fileName || !body.data?.bookId) {
      return { success: false as const, error: 'The import did not return required data. Please refresh and retry.' };
    }

    jobId = body.data.jobId;
    fileName = body.data.fileName;
    resolvedBookId = body.data.bookId;
    newBookCreated = body.data.newBookCreated ?? false;
  }

  if (!jobId) {
    return { success: false as const, error: 'The import did not return a job id. Please refresh and retry.' };
  }

  // Poll the job until it reaches a terminal state.
  const maxWaitMs = 40 * 60 * 1000; // give a 500k-char novel ~40 minutes
  const pollEveryMs = 5000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    let poll: Response;
    try {
      poll = await fetch(`/api/story-bible/import-manuscript?jobId=${encodeURIComponent(jobId)}`);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
      continue; // transient network blip — keep polling
    }

    const pollBody = (await poll.json().catch(() => null)) as {
      success?: boolean;
      status?: string;
      error?: string;
      data?: ManuscriptImportResult;
      progressMessage?: string;
      progressPercent?: number;
    } | null;

    if (pollBody) {
      if (pollBody.status === 'completed' && pollBody.data) {
        onProgress?.({ message: 'Import complete', percent: 100 });
        return { success: true as const, data: pollBody.data };
      }
      if (pollBody.status === 'failed') {
        return { success: false as const, error: pollBody.error || 'The manuscript import failed. Please try again.' };
      }
      if (pollBody.status === 'queued' || pollBody.status === 'active') {
        onProgress?.({
          message: pollBody.progressMessage,
          percent: pollBody.progressPercent,
        });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollEveryMs));
  }

  return {
    success: false as const,
    error: 'The import is taking longer than expected. Keep this tab open, or refresh the Story Bible in a few minutes to see the results.',
  };
}

export interface IdeaTransferInput {
  bookId: string;
  ideaText: string;
  title?: string;
  blurb?: string;
  chapters?: { number: number; title: string; synopsis: string }[];
  coverConcept?: string;
}

export async function transferIdeaToStoryBible(input: IdeaTransferInput) {
  return apiFetch<{ entities: StoryBibleEntity[]; total: number }>('/story-bible/transfer', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ─── Editorial Review API ─────────────────────────────────────────────────────

export type EditorialSeverity = 'critical' | 'warning' | 'info';
export type EditorialCategory =
  | 'TIMELINE'
  | 'CHARACTER'
  | 'CONTINUITY'
  | 'CROSS_REFERENCE'
  | 'PLOT_HOLE'
  | 'LOCATION'
  | 'POV'
  | 'FACTUAL'
  | 'DIALOGUE'
  | 'OTHER';
export type EditorialFindingStatus = 'open' | 'fixed' | 'ignored';

export interface EditorialReviewSummary {
  id: string;
  bookId: string | null;
  scope: 'book' | 'manuscript';
  sourceLabel: string;
  status: 'queued' | 'active' | 'completed' | 'failed';
  textLength: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  findingCount: number;
}

export interface EditorialFindingData {
  id: string;
  reviewId: string;
  severity: EditorialSeverity;
  category: EditorialCategory;
  title: string;
  description: string;
  quote: string;
  location: string;
  bookTitle: string;
  suggestion: string;
  status: EditorialFindingStatus;
  createdAt: string;
}

export interface EditorialReviewDetail extends EditorialReviewSummary {
  findings: EditorialFindingData[];
}

export async function runEditorialReview(input: {
  bookIds?: string[];
  file?: File;
  title?: string;
}) {
  const formData = new FormData();
  if (input.bookIds && input.bookIds.length > 0) {
    formData.append('bookIds', JSON.stringify(input.bookIds));
  }
  if (input.file) {
    formData.append('file', input.file);
  }
  if (input.title) {
    formData.append('title', input.title);
  }
  const response = await fetch('/api/universe/review', {
    method: 'POST',
    body: formData,
  });
  return (await response.json()) as {
    success: boolean;
    data?: { reviewId: string; jobId: string };
    error?: string;
  };
}

export async function listEditorialReviews(): Promise<EditorialReviewSummary[]> {
  const result = await apiFetch<EditorialReviewSummary[]>('/universe/review');
  return result.data ?? [];
}

export async function getEditorialReview(id: string) {
  return apiFetch<EditorialReviewDetail>(`/universe/review/${id}`);
}

export async function updateEditorialFindingStatus(
  reviewId: string,
  findingId: string,
  status: EditorialFindingStatus
) {
  return apiFetch<{ id: string; status: string }>(
    `/universe/review/${reviewId}/finding/${findingId}`,
    { method: 'PATCH', body: JSON.stringify({ status }) }
  );
}

export async function deleteEditorialReview(id: string) {
  return apiFetch<{ deleted: boolean }>(`/universe/review/${id}`, {
    method: 'DELETE',
  });
}

export interface AutoPopulateResult {
  storyBibleJobId: string;
  editorialReviewId: string | null;
}

export async function autoPopulateStoryBibleAndUniverse(bookId: string): Promise<AutoPopulateResult> {
  const response = await fetch('/api/story-bible/auto-populate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId }),
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(body.error || 'Auto-populate failed');
  }
  return body.data;
}
