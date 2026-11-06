// List the most recent PDF exports in Cloudflare R2.
//
// Previously this listed Supabase Storage; storage is R2-only now. Loading
// dotenv before the dynamic import keeps this script independent of Prisma
// (and therefore of DATABASE_URL).

import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  },
});

const result = await client.send(
  new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET_KEY,
    Prefix: 'pdfs/',
    MaxKeys: 10,
  }),
);

console.log(
  'LIST',
  JSON.stringify(
    (result.Contents ?? []).map((o) => ({
      key: o.Key,
      size: o.Size,
      lastModified: o.LastModified,
    })),
    null,
    1,
  ),
);
