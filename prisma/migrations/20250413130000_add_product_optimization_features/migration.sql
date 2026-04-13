-- Migration: Add Product Optimization Features
-- Created: 2026-04-13
-- Description: Add Sincerity System, Vault Features, and Profile Extensions

-- ═══════════════════════════════════════════════════════════════
-- STEP 1: Create New Enums
-- ═══════════════════════════════════════════════════════════════

-- Vault Status Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VaultStatus') THEN
        CREATE TYPE "VaultStatus" AS ENUM ('ACTIVE', 'EXTENDED', 'REVOKED', 'EXPIRED');
    END IF;
END$$;

-- Sincerity Transaction Type Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SincerityTransactionType') THEN
        CREATE TYPE "SincerityTransactionType" AS ENUM ('EARN', 'SPEND', 'RECEIVE_GIFT', 'SEND_GIFT', 'REFUND');
    END IF;
END$$;

-- Sincerity Tier Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SincerityTier') THEN
        CREATE TYPE "SincerityTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');
    END IF;
END$$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: Create SincerityWallet Table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "SincerityWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "totalGifted" INTEGER NOT NULL DEFAULT 0,
    "totalReceived" INTEGER NOT NULL DEFAULT 0,
    "tier" "SincerityTier" NOT NULL DEFAULT 'BRONZE',
    "tierProgress" DOUBLE PRECISION DEFAULT 0,
    "lastEarnedAt" TIMESTAMP(3),
    "lastSpentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SincerityWallet_pkey" PRIMARY KEY ("id")
);

-- Create unique index on userId
CREATE UNIQUE INDEX IF NOT EXISTS "SincerityWallet_userId_key" ON "SincerityWallet"("userId");

-- Create indexes
CREATE INDEX IF NOT EXISTS "SincerityWallet_tier_idx" ON "SincerityWallet"("tier");
CREATE INDEX IF NOT EXISTS "SincerityWallet_balance_idx" ON "SincerityWallet"("balance");

-- Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'SincerityWallet_userId_fkey' 
        AND table_name = 'SincerityWallet'
    ) THEN
        ALTER TABLE "SincerityWallet" 
        ADD CONSTRAINT "SincerityWallet_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "Profile"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 3: Create SincerityTransaction Table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "SincerityTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "SincerityTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "description" TEXT,
    "matchId" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "message" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SincerityTransaction_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "SincerityTransaction_walletId_idx" ON "SincerityTransaction"("walletId");
CREATE INDEX IF NOT EXISTS "SincerityTransaction_type_idx" ON "SincerityTransaction"("type");
CREATE INDEX IF NOT EXISTS "SincerityTransaction_createdAt_idx" ON "SincerityTransaction"("createdAt");
CREATE INDEX IF NOT EXISTS "SincerityTransaction_source_idx" ON "SincerityTransaction"("source");

-- Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'SincerityTransaction_walletId_fkey' 
        AND table_name = 'SincerityTransaction'
    ) THEN
        ALTER TABLE "SincerityTransaction" 
        ADD CONSTRAINT "SincerityTransaction_walletId_fkey" 
        FOREIGN KEY ("walletId") REFERENCES "SincerityWallet"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END$$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 4: Extend Profile Table
-- ═══════════════════════════════════════════════════════════════

-- Add professional info columns
ALTER TABLE "Profile" 
    ADD COLUMN IF NOT EXISTS "occupation" TEXT,
    ADD COLUMN IF NOT EXISTS "company" TEXT,
    ADD COLUMN IF NOT EXISTS "industry" TEXT,
    ADD COLUMN IF NOT EXISTS "linkedInVerified" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "verificationBadge" TEXT;

-- Create index on linkedInVerified
CREATE INDEX IF NOT EXISTS "Profile_linkedInVerified_idx" ON "Profile"("linkedInVerified");

-- ═══════════════════════════════════════════════════════════════
-- STEP 5: Extend Match Table
-- ═══════════════════════════════════════════════════════════════

-- Add pitch message and gift columns
ALTER TABLE "Match" 
    ADD COLUMN IF NOT EXISTS "pitchMessage" TEXT,
    ADD COLUMN IF NOT EXISTS "pitchTone" TEXT,
    ADD COLUMN IF NOT EXISTS "aiAssisted" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "giftAmount" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "isUnread" BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS "inboxPriority" DOUBLE PRECISION;

-- Create indexes
CREATE INDEX IF NOT EXISTS "Match_isUnread_idx" ON "Match"("isUnread");
CREATE INDEX IF NOT EXISTS "Match_inboxPriority_idx" ON "Match"("inboxPriority");

-- ═══════════════════════════════════════════════════════════════
-- STEP 6: Extend ChatRoom Table (The Vault)
-- ═══════════════════════════════════════════════════════════════

-- Add vault status column
ALTER TABLE "ChatRoom" 
    ADD COLUMN IF NOT EXISTS "vaultStatus" TEXT DEFAULT 'ACTIVE',
    ADD COLUMN IF NOT EXISTS "vaultExpiry" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "extendedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "extendedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "extensionCount" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "revokedBy" TEXT,
    ADD COLUMN IF NOT EXISTS "revokeReason" TEXT,
    ADD COLUMN IF NOT EXISTS "screenshotCount" INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "lastScreenshotAt" TIMESTAMP(3);

-- Create indexes
CREATE INDEX IF NOT EXISTS "ChatRoom_vaultStatus_idx" ON "ChatRoom"("vaultStatus");
CREATE INDEX IF NOT EXISTS "ChatRoom_vaultExpiry_idx" ON "ChatRoom"("vaultExpiry");

-- ═══════════════════════════════════════════════════════════════
-- STEP 7: Migration Complete
-- ═══════════════════════════════════════════════════════════════

-- Verify migration
SELECT 
    'SincerityWallet' as table_name, 
    COUNT(*) as row_count 
FROM "SincerityWallet"
UNION ALL
SELECT 
    'SincerityTransaction' as table_name, 
    COUNT(*) as row_count 
FROM "SincerityTransaction";
