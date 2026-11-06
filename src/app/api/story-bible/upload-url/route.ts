// HydraSkript - Presigned Upload URL for Manuscripts
// Returns a presigned URL for direct upload to Supabase Storage or R2,
// bypassing the 4.5 MB Vercel serverless payload limit.

import { NextRequest, NextResponse } from 'next/server';
import { isUnauthorizedError, requireProfile, unauthorizedResponse } from '@/lib/api-auth';
import { generateFilename, getR2Client, isR2Enabled, getR2PublicUrl } from '@/lib/utils/storage';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const SUPPORTED_EXTENSIONS = new Set(['txt', 'pdf', 'docx']);

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

    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: `File size ${(fileSize / 1024 / 1024).toFixed(1)} MB exceeds the 25 MB limit.` },
        { status: 413 }
      );
    }

    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      return NextResponse.json(
        { success: false, error: 'Unsupported file type. Please upload a .txt, .pdf, or .docx file.' },
        { status: 400 }
      );
    }

    // Generate a unique storage path: manuscripts/{userId}/{timestamp}_{random}.{ext}
    const uniqueFileName = generateFilename(`manuscript_${profile.id}`, extension);
    const storagePath = `manuscripts/${profile.id}/${uniqueFileName}`;

    let uploadUrl: string;
    let publicUrl: string;
    let storageProvider: 'r2' | 'local';

    // Priority: R2 → Local
    if (isR2Enabled()) {
      // Use Cloudflare R2 presigned URL
      const r2Client = getR2Client();

      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_KEY,
        Key: storagePath,
        ContentType: contentType || 'application/octet-stream',
      });

      uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 3600 }); // 1 hour
      publicUrl = `${getR2PublicUrl()}/${storagePath}`;
      storageProvider = 'r2';
    } else {
      // Local development fallback - return a local upload endpoint
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
        expiresIn: 3600, // seconds
      },
    });
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return unauthorizedResponse();
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/story-bible/upload-url] Failed:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}