// HydraSkript - Storage Utility
// Priority: Cloudflare R2 → local filesystem (development only)
//
// Supabase Storage was removed in favour of the existing R2 integration. There
// is deliberately no cloud-storage fallback beyond R2: serverless filesystems
// are read-only, so a silent fallback to disk would lose the file.

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { db } from '@/lib/db';

// ─── Configuration ────────────────────────────────────────────────────────────

const STORAGE_DIR = path.join(process.cwd(), 'public', 'assets');
const PUBLIC_BASE = '/assets';

// ─── Cloudflare R2 ──────────────────────────────────────────────────────────

export function isR2Enabled() {
  return Boolean(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_KEY);
}

let _r2Client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (!_r2Client) {
    _r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _r2Client;
}

export function getR2PublicUrl(): string {
  return process.env.R2_PUBLIC_URL || '';
}

/**
 * True when a URL belongs to the configured R2 public bucket.
 *
 * Compares against R2_PUBLIC_URL rather than the S3 endpoint
 * (`*.r2.cloudflarestorage.com`): public assets are served from the bucket's
 * public URL / custom domain, never from the S3 API host, so the old endpoint
 * check never matched a real asset URL.
 */
export function isR2PublicUrl(publicUrl: string): boolean {
  const base = getR2PublicUrl();
  return Boolean(base) && publicUrl.startsWith(`${base.replace(/\/+$/, '')}/`);
}

export function r2KeyFromPublicUrl(publicUrl: string): string | null {
  if (!isR2PublicUrl(publicUrl)) return null;
  const base = getR2PublicUrl().replace(/\/+$/, '');
  return publicUrl.slice(base.length + 1);
}

/**
 * Human-readable storage configuration, used in errors so a failed upload
 * names the missing variables instead of surfacing as a filesystem error.
 */
export function getStorageConfigReport(): string {
  const r2 = isR2Enabled()
    ? 'R2: configured'
    : 'R2: missing (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_KEY)';
  const local = isServerlessRuntime()
    ? 'local filesystem: unavailable (serverless)'
    : 'local filesystem: available (development only)';
  return `${r2} | ${local}`;
}

// ─── Local filesystem (dev only) ────────────────────────────────────────────

/**
 * Serverless runtimes (Vercel, Lambda, Cloud Run) mount a READ-ONLY filesystem.
 * Mirrors the detection already used in `lib/db.ts` and `lib/llm/budget.ts`.
 */
function isServerlessRuntime(): boolean {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.AWS_EXECUTION_ENV ||
      process.env.FUNCTION_TARGET
  );
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {
      throw new Error(
        `Cannot create local storage directory "${dir}". Server filesystems ` +
          `are read-only in production — configure R2. ` +
          `Original error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}

// ─── File Operations ──────────────────────────────────────────────────────────

/**
 * Save a buffer to storage and return the public URL.
 * Priority: Cloudflare R2 → local disk.
 */
export async function saveFile(
  subfolder: string,
  filename: string,
  buffer: Buffer,
  options?: { contentType?: string }
): Promise<string> {
  const contentType = options?.contentType ?? 'application/octet-stream';

  // 1. Cloudflare R2
  if (isR2Enabled()) {
    const key = `${subfolder}/${filename}`;
    const client = getR2Client();
    try {
      await client.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_KEY,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }));
      const publicUrl = `${getR2PublicUrl().replace(/\/+$/, '')}/${key}`;
      console.log(`[Storage] Uploaded to R2: ${key}`);
      return publicUrl;
    } catch (error) {
      // Fall through to local disk only outside serverless; in production the
      // disk is read-only, so surfacing the real R2 error is more useful.
      console.warn(
        `[Storage] R2 upload failed (${error instanceof Error ? error.message : String(error)}).`
      );
    }
  }

  // 2. Local filesystem (dev only)
  if (isServerlessRuntime()) {
    throw new Error(
      `Refusing to write "${subfolder}/${filename}" to the local filesystem: this ` +
        `runtime mounts a read-only disk, so the file would be lost even if the ` +
        `write succeeded. Configure cloud storage instead — ${getStorageConfigReport()}. ` +
        `On Vercel set the R2_* variables for the Production scope, then redeploy.`
    );
  }

  const dir = path.join(STORAGE_DIR, subfolder);
  ensureDir(dir);
  const filePath = path.join(dir, filename);
  try {
    fs.writeFileSync(filePath, buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Cannot write file to local storage ("${filePath}"). Server filesystems ` +
        `are read-only in production — configure R2. ` +
        `Original error: ${msg}`
    );
  }
  console.log(`[Storage] Saved locally: ${filePath}`);
  return `${PUBLIC_BASE}/${subfolder}/${filename}`;
}

/**
 * Save a base64-encoded file to storage and return the public URL.
 */
export async function saveBase64File(
  subfolder: string,
  filename: string,
  base64Data: string,
  options?: { contentType?: string }
): Promise<string> {
  const buffer = Buffer.from(base64Data, 'base64');
  return saveFile(subfolder, filename, buffer, options);
}

/**
 * Delete a file from storage.
 */
export async function deleteFile(publicUrl: string): Promise<boolean> {
  try {
    // R2
    const key = r2KeyFromPublicUrl(publicUrl);
    if (isR2Enabled() && key) {
      const client = getR2Client();
      await client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_KEY,
        Key: key,
      }));
      console.log(`[Storage] Deleted from R2: ${key}`);
      return true;
    }

    // Local filesystem
    if (!publicUrl.startsWith(PUBLIC_BASE)) return false;
    const relativePath = publicUrl.slice(PUBLIC_BASE.length).replace(/^\/+/, '');
    const filePath = path.join(STORAGE_DIR, relativePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[Storage] Delete failed:', error);
    return false;
  }
}

/**
 * Check if a file exists in storage.
 */
export async function fileExists(publicUrl: string): Promise<boolean> {
  try {
    // R2 — HEAD the object
    const key = r2KeyFromPublicUrl(publicUrl);
    if (isR2Enabled() && key) {
      try {
        await getR2Client().send(new HeadObjectCommand({
          Bucket: process.env.R2_BUCKET_KEY,
          Key: key,
        }));
        return true;
      } catch {
        return false;
      }
    }

    // Local filesystem
    if (!publicUrl.startsWith(PUBLIC_BASE)) return false;
    const relativePath = publicUrl.slice(PUBLIC_BASE.length).replace(/^\/+/, '');
    return fs.existsSync(path.join(STORAGE_DIR, relativePath));
  } catch {
    return false;
  }
}

/**
 * Generate a unique filename with timestamp.
 */
export function generateFilename(prefix: string, extension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${timestamp}_${random}.${extension}`;
}

// ─── Media Asset Database Records ─────────────────────────────────────────────

/**
 * Create a media asset record in the database.
 */
export async function createMediaAsset(params: {
  ownerId: string;
  bookId?: string;
  assetType: string;
  storagePath: string;
  publicUrl: string;
  metadata?: Record<string, unknown>;
}) {
  return db.mediaAsset.create({
    data: {
      ownerId: params.ownerId,
      bookId: params.bookId,
      assetType: params.assetType,
      storagePath: params.storagePath,
      publicUrl: params.publicUrl,
      metadata: JSON.stringify(params.metadata ?? {}),
    },
  });
}
