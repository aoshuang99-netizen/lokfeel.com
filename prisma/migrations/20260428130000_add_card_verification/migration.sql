-- AlterTable: Add credit card verification fields to User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cardVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cardVerifiedAt" TIMESTAMP(3);
