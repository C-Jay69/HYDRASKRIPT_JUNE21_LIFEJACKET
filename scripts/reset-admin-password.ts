// Reset an admin account's password directly in Postgres.
//
// Replaces the old Supabase admin listUsers/updateUserById flow. Passwords are
// bcrypt, which is exactly what NextAuth's Credentials provider verifies.
//
// Usage:
//   npx tsx scripts/reset-admin-password.ts
//   ADMIN_EMAIL=me@example.com ADMIN_PASSWORD='...' npx tsx scripts/reset-admin-password.ts

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const db = new PrismaClient({ adapter })

async function resetAdminPassword() {
  const email = (process.env.ADMIN_EMAIL || 'admin@hydraskript.com')
    .trim()
    .toLowerCase()
  const newPassword = process.env.ADMIN_PASSWORD || 'Admin123!@#'

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12)

    const profile = await db.profile.upsert({
      where: { email },
      update: {
        passwordHash,
        isAdmin: true,
        tier: 'studio',
        credits: 100000,
      },
      create: {
        email,
        passwordHash,
        name: email.split('@')[0],
        isAdmin: true,
        tier: 'studio',
        credits: 100000,
      },
    })

    console.log('✅ Password reset successfully!')
    console.log('Email:', profile.email)
    console.log('New Password:', newPassword)
    console.log('Profile ID:', profile.id)
    console.log('Admin:', profile.isAdmin)
  } catch (err) {
    console.error('Unexpected error:', err)
    process.exitCode = 1
  } finally {
    await db.$disconnect()
  }
}

resetAdminPassword()
