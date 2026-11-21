-- V25.6 UX06 — 服务端 AI 处理授权（consentRef 由服务端签发并持久化）
-- 纯标量字段，不引入外键，避免改动 User/Conversation 关系网。
CREATE TABLE "AIProcessingConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipientScope" TEXT NOT NULL,
    "processingLocation" TEXT NOT NULL DEFAULT 'cloud',
    "modelScope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "requestId" TEXT,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "AIProcessingConsent_userId_status_idx" ON "AIProcessingConsent"("userId", "status");
CREATE INDEX "AIProcessingConsent_conversationId_idx" ON "AIProcessingConsent"("conversationId");
CREATE INDEX "AIProcessingConsent_expiresAt_idx" ON "AIProcessingConsent"("expiresAt");
