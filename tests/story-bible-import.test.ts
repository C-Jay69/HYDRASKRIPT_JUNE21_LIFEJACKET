// Integration test: Story Bible manuscript import pipeline.
// Exercises the REAL route handler + REAL extraction/windowing/merge logic,
// with the LLM and database mocked so the test runs without network/DB.
import { NextRequest } from 'next/server';

// ── In-memory DB fake ────────────────────────────────────────────────────────
type EntityRow = {
  id: string;
  ownerId: string;
  bookId: string;
  kind: string;
  name: string;
  role: string;
  summary: string;
  motivation: string;
  description: string;
  physicalTraits: string;
  secrets: string;
  portraitUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

let idCounter = 0;
const nextId = () => {
  const n = ++idCounter;
  return `36000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
};

const books: Record<string, { id: string; ownerId: string; title: string; genre: string; targetAudience: string; status: string }> = {};
const entities: EntityRow[] = [];
const chapters: { bookId: string; index: number; title: string; content: string }[] = [];

// Minimal in-memory `Job` store so the worker and the poll GET can run end-to-end.
type JobRow = {
  id: string;
  ownerId: string;
  bookId: string | null;
  jobType: string;
  status: string;
  result: string;
  progressMessage: string;
  progressPercent: number;
  errorMessage: string | null;
};
const jobs: Record<string, JobRow> = {};

const fakeDb = {
  book: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const book = { id: nextId(), ownerId: '', genre: 'fiction', targetAudience: 'adult', status: 'draft', ...data } as (typeof books)[string];
      books[book.id] = book;
      return { ...book };
    },
    findUnique: async ({ where }: { where: { id: string; ownerId?: string } }) => {
      const b = books[where.id];
      if (!b) return null;
      if (where.ownerId && b.ownerId !== where.ownerId) return null;
      return { ...b };
    },
    findFirst: async ({ where }: { where: { id: string; ownerId?: string } }) => {
      const b = books[where.id];
      if (!b) return null;
      if (where.ownerId && b.ownerId !== where.ownerId) return null;
      return { ...b };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const b = books[where.id];
      if (!b) throw new Error('book not found');
      Object.assign(b, data);
      return { ...b };
    },
  },
  chapter: {
    count: async ({ where }: { where: { bookId: string } }) =>
      chapters.filter((c) => c.bookId === where.bookId).length,
    findMany: async ({ where, select }: { where: { bookId: string }; select?: { content: boolean } }) =>
      chapters
        .filter((c) => c.bookId === where.bookId)
        .map((c) => (select?.content ? { content: c.content } : { ...c })),
    deleteMany: async ({ where }: { where: { bookId: string } }) => {
      const before = chapters.length;
      for (let i = chapters.length - 1; i >= 0; i--) {
        if (chapters[i].bookId === where.bookId) chapters.splice(i, 1);
      }
      return { count: before - chapters.length };
    },
    createMany: async ({ data }: { data: { bookId: string; index: number; title: string; content: string }[] }) => {
      chapters.push(...data);
      return { count: data.length };
    },
  },
  job: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const j = jobs[where.id];
      if (!j) return null;
      return { ...j };
    },
  },
  storyBibleEntity: {
    findMany: async ({ where, select }: { where: { bookId?: string }; select?: { kind: boolean; name: boolean } }) => {
      let rows = entities.filter((e) => (where.bookId ? e.bookId === where.bookId : true));
      if (select) {
        rows = rows.map((e) => ({ kind: e.kind, name: e.name })) as unknown as EntityRow[];
      }
      return rows;
    },
    create: async ({ data }: { data: Omit<EntityRow, 'id' | 'createdAt' | 'updatedAt'> }) => {
      const row: EntityRow = {
        id: nextId(),
        portraitUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      entities.push(row);
      return { ...row };
    },
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
};

jest.mock('@/lib/db', () => ({ db: fakeDb }));
jest.mock('@/lib/api-auth', () => ({
  requireProfile: async () => ({ email: 'test@example.com', profile: { id: 'profile-1' } }),
  unauthorizedResponse: () => ({ status: 401 }),
  isUnauthorizedError: (e: unknown) => e instanceof Error && e.name === 'UnauthorizedError',
}));
jest.mock('@/lib/services/editorialReview', () => ({ enqueueEditorialReview: async () => ({ reviewId: 'rev-1', jobId: 'job-1' }) }));

// ── Fake job queue (mocks @/lib/workers/queue) ────────────────────────────────
// The route enqueues via `getJobQueue()`, the worker processes via `jobQueue`.
// Both share this same mock so `createJob`/`startJob`/`updateJobStatus` all hit
// the same in-memory `jobs` store the fake DB reads from.
const mockQueue = {
  createJob: async (params: {
    ownerId: string;
    bookId?: string | null;
    jobType: string;
    creditsReserved?: number;
    maxRetries?: number;
    result?: string | Record<string, unknown>;
  }) => {
    // The poll GET validates that jobId is a UUID — mint a real-format one.
    const rawId = nextId('job');
    const n = parseInt(rawId.split('-')[1], 10);
    const id = `36000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    jobs[id] = {
      id,
      ownerId: params.ownerId,
      bookId: params.bookId ?? null,
      jobType: params.jobType,
      status: 'queued',
      result: params.result ? (typeof params.result === 'string' ? params.result : JSON.stringify(params.result)) : '{}',
      progressMessage: 'Queued...',
      progressPercent: 0,
      errorMessage: null,
    };
    return id;
  },
  startJob: async () => {},
  updateJobStatus: async (jobId: string, update: {
    status?: string;
    progressMessage?: string;
    progressPercent?: number;
    errorMessage?: string;
    result?: unknown;
    mergeResult?: boolean;
  }) => {
    const job = jobs[jobId];
    if (!job) throw new Error(`no such job ${jobId}`);
    if (update.status) job.status = update.status;
    if (update.progressMessage) job.progressMessage = update.progressMessage;
    if (update.progressPercent !== undefined) job.progressPercent = update.progressPercent;
    if (update.errorMessage) job.errorMessage = update.errorMessage;
    if (update.result !== undefined) {
      const incoming = typeof update.result === 'string' ? update.result : JSON.stringify(update.result);
      if (update.mergeResult) {
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(job.result) as Record<string, unknown>; } catch { parsed = {}; }
        const next = typeof update.result === 'string' ? JSON.parse(update.result) : update.result;
        job.result = JSON.stringify({ ...parsed, ...(next as object) });
      } else {
        job.result = incoming;
      }
    }
  },
};

jest.mock('@/lib/workers/queue', () => ({
  getJobQueue: () => mockQueue,
  jobQueue: mockQueue,
}));

// ── Mocked LLM ───────────────────────────────────────────────────────────────
// Simulates a real model: window 0 returns a rich cast; later windows return
// NEW entities (respecting the "already captured" roster in the system prompt)
// plus one duplicate to verify merging.
const llmCalls: { system: string; user: string }[] = [];

jest.mock('@/lib/llm/fallback', () => ({
  askLLMJSONWithFallback: async (system: string, user: string) => {
    llmCalls.push({ system, user });
    // Window 0 is the raw text; later windows are prefixed "This is portion N of M"
    const m = user.match(/This is portion (\d+) of/);
    const idx = m ? parseInt(m[1], 10) - 1 : 0;
    if (idx === 0) {
      return {
        entities: [
          { kind: 'CHARACTER', name: 'Mara Voss', role: 'Protagonist', summary: 'Detective hunting her missing sister.', motivation: 'Justice for her sister', description: 'Tall, grey eyes, a scar across her left brow. Drinks black coffee, never sleeps more than four hours.', tags: ['tall', 'scarred', 'stubborn'] },
          { kind: 'CHARACTER', name: 'Corvin Hale', role: 'Antagonist', summary: 'Harbormaster who controls the docklands.', motivation: 'Power over New Carthage', description: 'Silver-tongued, wears a waxed coat, keeps a ledger of debts.', tags: ['ruthless', 'charismatic'] },
          { kind: 'LOCATION', name: 'New Carthage', role: 'Capital City', summary: 'Rain-slicked port city where the story begins.', motivation: 'The story’s main setting', description: 'Narrow lanes, gaslit docks, a wall of fog that never lifts before noon.', tags: ['port city', 'foggy', 'industrial'] },
          { kind: 'OBJECT', name: 'The Ledger of Hale', role: 'MacGuffin', summary: 'A book of debts that can ruin or save anyone named in it.', motivation: 'Its entries decide who lives free', description: 'Leather-bound, stamped with a harbor seal, entries written in ink that changes color.', tags: ['artifact', 'book', 'secrecy'] },
          { kind: 'THEME', name: 'Debt and Redemption', role: 'Central Theme', summary: 'The cost of what we owe, and whether it can be repaid.', motivation: 'Drives every conflict in the book', description: 'Characters trade favors, secrets, and blood to settle what they owe.', tags: ['debt', 'redemption', 'moral debt'] },
          { kind: 'HISTORY', name: 'The Salt Wars', role: 'Backstory Event', summary: 'A century-old war over the salt flats that scarred New Carthage.', motivation: 'Explains present-day tensions in the docks', description: 'Fought over harvested salt; ended in a treaty no one remembers the terms of.', tags: ['war', 'treaty', 'salt flats'] },
        ],
      };
    }
    // Later windows: new entities + one repeat of an early one (merge check)
    if (idx === 1) {
      return {
        entities: [
          { kind: 'CHARACTER', name: 'Ilya Voss', role: 'Missing Sister', summary: 'Mara’s sister, last seen at the salt flats.', motivation: 'Survive', description: 'Blonde, quiet, always wore her mother’s blue ring.', tags: ['missing', 'blonde'] },
          { kind: 'LOCATION', name: 'The Salt Flats', role: 'Crime Scene', summary: 'White wasteland beyond the city where Ilya vanished.', motivation: 'Where the truth is buried', description: 'Blinding white, shallow water, bones of old lighthouses.', tags: ['wasteland', 'cold', 'remote'] },
          { kind: 'CHARACTER', name: 'Mara Voss', role: 'Protagonist', summary: 'Detective hunting her missing sister.', motivation: 'Justice for her sister', description: 'Tall, grey eyes, a scar across her left brow. Drinks black coffee, never sleeps more than four hours. In port one, her reflection in a wet window shows the scar is older than she remembers.', tags: ['tall', 'scarred', 'stubborn', 'coffee'] },
        ],
      };
    }
    // Window 2: nothing new (legitimate empty portion)
    return { entities: [] };
  },
}));

import { POST, GET as importPollGET } from '@/app/api/story-bible/import-manuscript/route';
import { GET as listStoryBible } from '@/app/api/story-bible/route';

function makeManuscript(): string {
  // Long enough to produce 3+ windows (> 36k chars, step 32k → need > 64k for 3)
  const para =
    'Mara Voss stood on the docks of New Carthage, the fog pressing against her like a damp cloth. ' +
    'Somewhere past the gaslight, the Salt Flats waited, white and indifferent. She thought of Ilya, of the blue ring, of the Ledger of Hale and the debts written in it. ' +
    'Corvin Hale had always collected. The Salt Wars had ended a hundred years ago, but the harbor still remembered every name. ';
  let text = '';
  let i = 0;
  while (text.length < 70000) {
    text += `Chapter ${i}: ${para.repeat(8)}\n\n`;
    i += 1;
  }
  return text;
}

function makeRequest(bookId: string | null, fileName: string, content: string): NextRequest {
  const form = new FormData();
  if (bookId) form.append('bookId', bookId);
  form.append('file', new File([content], fileName, { type: 'text/plain' }));
  return new NextRequest('http://localhost:3002/api/story-bible/import-manuscript', {
    method: 'POST',
    body: form,
  });
}

// Drive the chunked worker until the job reaches a terminal state, exactly the
// way the pump does on production (`processOneQueuedJob` → worker → re-queue).
async function runWorkerUntilDone(jobId: string): Promise<string> {
  const { importManuscriptWorker } = await import('@/lib/workers/importManuscriptWorker');
  for (let i = 0; i < 100; i++) {
    const job = jobs[jobId];
    if (!job) throw new Error(`job ${jobId} vanished`);
    if (job.status === 'completed') return 'completed';
    if (job.status === 'failed') return 'failed';
    await importManuscriptWorker({ id: jobId });
  }
  throw new Error(`job ${jobId} did not finish after 100 worker runs`);
}

async function pollImport(jobId: string): Promise<{ status?: string; data?: any; error?: string }> {
  const req = new NextRequest(`http://localhost:3002/api/story-bible/import-manuscript?jobId=${jobId}`);
  const res = await importPollGET(req);
  return res.json();
}

describe('Story Bible manuscript import', () => {
  beforeEach(() => {
    entities.length = 0;
    chapters.length = 0;
    Object.keys(books).forEach((k) => delete books[k]);
    Object.keys(jobs).forEach((k) => delete jobs[k]);
    llmCalls.length = 0;
  });

  test('imports an existing book, populates ALL five kinds, persists, and lists them', async () => {
    // Pre-create a book the user is importing into
    await fakeDb.book.create({ data: { title: 'The Harbor Debts', ownerId: 'profile-1' } });
    const book = Object.values(books)[0];

    // POST enqueues instantly and hands back a job id
    const res = await POST(makeRequest(book.id, 'harbor-debts.txt', makeManuscript()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.jobId).toBeTruthy();
    expect(body.data.async).toBe(true);
    // Nothing persisted yet — the lock-step import is gone
    expect(entities.length).toBe(0);

    // The queue drives the chunked worker to completion (as the pump would)
    expect(await runWorkerUntilDone(body.data.jobId)).toBe('completed');

    const pollBody = await pollImport(body.data.jobId);
    expect(pollBody.status).toBe('completed');
    expect(pollBody.data.total).toBeGreaterThan(0);

    // All five sections of the story bible must be populated
    for (const kind of ['CHARACTER', 'LOCATION', 'OBJECT', 'THEME', 'HISTORY']) {
      expect(pollBody.data.counts[kind]).toBeGreaterThanOrEqual(1);
    }

    // Entities actually persisted in the (fake) DB
    const stored = entities.filter((e) => e.bookId === book.id);
    expect(stored.length).toBe(pollBody.data.total);
    expect(stored.some((e) => e.kind === 'CHARACTER' && e.name === 'Mara Voss')).toBe(true);

    // The list endpoint (what the Story Bible UI calls) returns them
    const listReq = new NextRequest(`http://localhost:3002/api/story-bible?bookId=${book.id}`);
    const listRes = await listStoryBible(listReq);
    const listBody = await listRes.json();
    expect(listBody.success).toBe(true);
    expect(listBody.data.length).toBe(pollBody.data.total);
    const kinds = new Set(listBody.data.map((e: EntityRow) => e.kind));
    for (const kind of ['CHARACTER', 'LOCATION', 'OBJECT', 'THEME', 'HISTORY']) {
      expect(kinds.has(kind)).toBe(true);
    }

    // The repeated "Mara Voss" from window 2 was merged, not duplicated
    const maras = stored.filter((e) => e.name === 'Mara Voss');
    expect(maras.length).toBe(1);
    // Merge kept the richer description
    expect(maras[0].description.length).toBeGreaterThan(100);

    // Every persisted entity has its sections populated (not blank shells)
    for (const e of stored) {
      expect(e.summary.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      const traits = JSON.parse(e.physicalTraits);
      expect(Array.isArray(traits.tags)).toBe(true);
    }
  });

  test('auto-creates a book when none is selected and returns its bookId', async () => {
    const res = await POST(makeRequest(null, 'my-great-book.txt', makeManuscript()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.jobId).toBeTruthy();
    expect(body.data.newBookCreated).toBe(true);

    expect(await runWorkerUntilDone(body.data.jobId)).toBe('completed');

    const pollBody = await pollImport(body.data.jobId);
    expect(pollBody.status).toBe('completed');
    expect(pollBody.data.bookId).toBeTruthy();
    expect(books[pollBody.data.bookId]).toBeDefined();
    expect(books[pollBody.data.bookId].title).toBe('my great book');
    const stored = entities.filter((e) => e.bookId === pollBody.data.bookId);
    expect(stored.length).toBe(pollBody.data.total);
  });

  test('re-importing the same manuscript does not duplicate and reports what was skipped', async () => {
    await fakeDb.book.create({ data: { title: 'The Harbor Debts', ownerId: 'profile-1' } });
    const book = Object.values(books)[0];

    const first = await POST(makeRequest(book.id, 'harbor-debts.txt', makeManuscript()));
    const firstBody = await first.json();
    expect(firstBody.success).toBe(true);
    expect(await runWorkerUntilDone(firstBody.data.jobId)).toBe('completed');
    const firstPoll = await pollImport(firstBody.data.jobId);
    const totalAfterFirst = entities.length;
    const firstTotal = firstPoll.data.total;
    expect(firstTotal).toBeGreaterThan(0);

    // Second import of the SAME manuscript: LLM returns the same entities → all deduped
    const second = await POST(makeRequest(book.id, 'harbor-debts.txt', makeManuscript()));
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.success).toBe(true);
    expect(await runWorkerUntilDone(secondBody.data.jobId)).toBe('completed');
    const secondPoll = await pollImport(secondBody.data.jobId);

    // No duplication
    expect(entities.length).toBe(totalAfterFirst);
    // And the response must be honest about what happened
    expect(secondPoll.data.duplicatesSkipped).toBe(firstTotal);
    expect(secondPoll.data.total).toBe(0);
  });

  test('reports unreadable text as a 400, not a false success', async () => {
    await fakeDb.book.create({ data: { title: 'Empty', ownerId: 'profile-1' } });
    const book = Object.values(books)[0];
    const res = await POST(makeRequest(book.id, 'blank.txt', '   \n  \n'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
