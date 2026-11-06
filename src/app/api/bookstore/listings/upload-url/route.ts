// HydraSkript - Presigned Upload URL for Bookstore Listings
// Returns a signed URL for direct-to-storage upload (file and/or cover),
// bypassing the ~4.5 MB Vercel serverless payload limit for large books.

import { NextRequest, NextResponse } from 'next/server';
import { isUnauthorizedError, requireProfile, unauthorizedResponse } from '@/lib/api-auth';
import { generateFilename, getR2Client, isR2Enabled, getR2PublicUrl } from '@/lib/utils/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const dynamic = 'force-dynamic';

const LISTING_EXTENSIONS = new Set(['pdf', 'epub', 'mp3', 'm4b', 'txt', 'docx']);
const COVER_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MAX_LISTING_BYTES = 500 * 1024 * 1024; // 500 MB
const MAX_COVER_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  try {
    const { profile } = await requireProfile(request);

    const body = await request.json();
    const { fileName, fileSize, contentType } = body as {
      fileName: string;
      fileSize: number;
      contentType?: string;
    };

    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json({ success: false, error: 'fileName is required' }, { status: 400 });
    }
    if (!fileSize || typeof fileSize !== 'number') {
      return NextResponse.json({ success: false, error: 'fileSize is required' }, { status: 400 });
    }

    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const isCover = COVER_EXTENSIONS.has(extension);
    const maxBytes = isCover ? MAX_COVER_BYTES : MAX_LISTING_BYTES;

    if (!isCover && !LISTING_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Please upload PDF, EPUB, MP3, M4B, TXT, DOCX (or a JPG/PNG/WebP cover).' },
        { status: 400 }
      );
    }

    if (fileSize > maxBytes) {
      const label = isCover ? '10 MB' : '500 MB';
      return NextResponse.json(
        { success: false, error: `File size ${(fileSize / 1024 / 1024).toFixed(1)} MB exceeds the ${label} limit.` },
        { status: 413 }
      );
    }

    const uniqueFileName = generateFilename(isCover ? 'cover' : 'listing', extension);
    const storagePath = `listings/${profile.id}/${uniqueFileName}`;

    let uploadUrl: string;
    let publicUrl: string;
    let storageProvider: 'r2' | 'local';

    if (isR2Enabled()) {
      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_KEY,
        Key: storagePath,
        ContentType: contentType || 'application/octet-stream',
      });

      uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 3600 });
      publicUrl = `${getR2PublicUrl()}/${storagePath}`;
      storageProvider = 'r2';
    } else {
      uploadUrl = `/api/story-bible/upload-local?path=${encodeURIComponent(storagePath)}`;
      publicUrl = `/assets/${storagePath}`;
      storageProvider = 'local';
    }

    return NextResponse.json({
      success: true,
      data: {
        uploadUrl,
        publicUrl,
        storagePath,
        storageProvider,
        expiresIn: 3600,
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) return unauthorizedResponse();
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/bookstore/listings/upload-url] Failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}