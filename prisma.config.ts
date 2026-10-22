import path from 'node:path'
import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// Prisma 7+ - Connection URL is passed to PrismaClient constructor
// The schema.prisma no longer needs a url field
export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    // CLI commands (migrate/introspect) must NOT use the transaction-mode
    // pooler URL (Supabase :6543): Prisma Migrate needs a session-level
    // advisory lock that transaction pooling cannot provide, so
    // `migrate deploy` against DATABASE_URL hangs forever at "Datasource".
    // Prefer DIRECT_URL (session-mode pooler :5432 / direct connection)
    // when present. The app runtime is unaffected — src/lib/db.ts builds
    // its own pool from DATABASE_URL.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
