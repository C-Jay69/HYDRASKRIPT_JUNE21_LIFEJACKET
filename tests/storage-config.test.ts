/**
 * Regression tests for the storage backend selection.
 *
 * Storage is R2-first, with a local-filesystem fallback for development only.
 * Supabase Storage was removed; these tests pin the two remaining paths and the
 * guard that refuses to "succeed" by writing to a read-only serverless disk —
 * the failure mode that originally produced
 *   ENOENT: no such file or directory, mkdir '/var/task/public/assets/audio-chunks'
 */

jest.mock('@/lib/db', () => ({ db: {} }));

jest.mock('@aws-sdk/client-s3', () => {
  const send = jest.fn();
  // Published on globalThis because `jest.resetModules()` (needed to get a
  // fresh storage module per case) re-runs this factory and would otherwise
  // leave the test holding a stale `send` from the previous registry.
  (globalThis as unknown as { __r2Send: jest.Mock }).__r2Send = send;
  return {
    __esModule: true,
    S3Client: jest.fn(() => ({ send })),
    PutObjectCommand: jest.fn((input: unknown) => ({ command: 'Put', input })),
    DeleteObjectCommand: jest.fn((input: unknown) => ({ command: 'Delete', input })),
    HeadObjectCommand: jest.fn((input: unknown) => ({ command: 'Head', input })),
  };
});

/** The `send` captured by the most recent (post-resetModules) mock factory. */
function r2Send(): jest.Mock {
  return (globalThis as unknown as { __r2Send: jest.Mock }).__r2Send;
}

// Mock the real fs so a regression that reaches the local-filesystem branch
// cannot escape a file into the working tree.
const fsMock = {
  existsSync: jest.fn(() => false),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
};
jest.mock('fs', () => fsMock);

const ENV_KEYS = [
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_KEY',
  'R2_ACCOUNT_ID',
  'R2_PUBLIC_URL',
  'VERCEL',
] as const;

type StorageModule = typeof import('@/lib/utils/storage');

/** Fresh module instance so module-level config caches cannot leak between cases. */
async function loadStorage(env: Record<string, string | undefined>): Promise<StorageModule> {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  jest.resetModules();
  return import('@/lib/utils/storage');
}

const R2_ENV = {
  R2_ACCESS_KEY_ID: 'key-id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_KEY: 'hydraskript-assets',
  R2_ACCOUNT_ID: 'account',
  R2_PUBLIC_URL: 'https://cdn.example.com',
};

beforeEach(() => {
  jest.clearAllMocks();
  fsMock.existsSync.mockReturnValue(false);
});

describe('storage backend detection', () => {
  it('enables R2 only when all three required variables are present', async () => {
    const enabled = await loadStorage(R2_ENV);
    expect(enabled.isR2Enabled()).toBe(true);

    const missingSecret = await loadStorage({ ...R2_ENV, R2_SECRET_ACCESS_KEY: undefined });
    expect(missingSecret.isR2Enabled()).toBe(false);
  });

  it('treats only URLs under R2_PUBLIC_URL as R2 objects', async () => {
    const storage = await loadStorage(R2_ENV);

    expect(storage.isR2PublicUrl('https://cdn.example.com/audio-chunks/a.wav')).toBe(true);
    expect(storage.isR2PublicUrl('https://elsewhere.example.com/a.wav')).toBe(false);
    expect(storage.r2KeyFromPublicUrl('https://cdn.example.com/audio-chunks/a.wav')).toBe(
      'audio-chunks/a.wav',
    );
    expect(storage.r2KeyFromPublicUrl('https://elsewhere.example.com/a.wav')).toBeNull();
  });
});

describe('saveFile', () => {
  it('uploads to R2 and returns the public URL', async () => {
    const storage = await loadStorage(R2_ENV);
    r2Send().mockResolvedValue({});

    const url = await storage.saveFile('audio-chunks', 'chunk_1.wav', Buffer.from('RIFF'), {
      contentType: 'audio/wav',
    });

    expect(r2Send()).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'Put',
        input: expect.objectContaining({
          Bucket: 'hydraskript-assets',
          Key: 'audio-chunks/chunk_1.wav',
          ContentType: 'audio/wav',
        }),
      }),
    );
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(url).toBe('https://cdn.example.com/audio-chunks/chunk_1.wav');
  });

  it('normalises a trailing slash on R2_PUBLIC_URL', async () => {
    const storage = await loadStorage({ ...R2_ENV, R2_PUBLIC_URL: 'https://cdn.example.com/' });
    r2Send().mockResolvedValue({});

    const url = await storage.saveFile('pdfs', 'book.pdf', Buffer.from('%PDF'));

    expect(url).toBe('https://cdn.example.com/pdfs/book.pdf');
  });

  it('falls back to the local filesystem in development when R2 is not configured', async () => {
    const storage = await loadStorage({});

    const url = await storage.saveFile('audio-chunks', 'chunk_1.wav', Buffer.from('RIFF'));

    expect(fsMock.writeFileSync).toHaveBeenCalled();
    expect(url).toBe('/assets/audio-chunks/chunk_1.wav');
  });

  it('fails with a configuration error on a read-only serverless runtime instead of writing to disk', async () => {
    const storage = await loadStorage({ VERCEL: '1' });

    await expect(
      storage.saveFile('audio-chunks', 'chunk_1.wav', Buffer.from('RIFF')),
    ).rejects.toThrow(/read-only disk/);

    expect(fsMock.mkdirSync).not.toHaveBeenCalled();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('deleteFile', () => {
  it('deletes an R2 object by deriving its key from the public URL', async () => {
    const storage = await loadStorage(R2_ENV);
    r2Send().mockResolvedValue({});

    const deleted = await storage.deleteFile('https://cdn.example.com/pdfs/book.pdf');

    expect(deleted).toBe(true);
    expect(r2Send()).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'Delete',
        input: { Bucket: 'hydraskript-assets', Key: 'pdfs/book.pdf' },
      }),
    );
  });

  it('ignores URLs that are not under R2_PUBLIC_URL', async () => {
    const storage = await loadStorage(R2_ENV);

    const deleted = await storage.deleteFile('https://someone-elses-cdn.example.com/x.pdf');

    expect(deleted).toBe(false);
    expect(r2Send()).not.toHaveBeenCalled();
  });
});
