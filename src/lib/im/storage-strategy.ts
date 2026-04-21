/**
 * Cold/Hot Storage Strategy — IM Message Lifecycle
 * 
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                       STORAGE ARCHITECTURE                       │
 * ├──────────────────────────────────────────────────────────────────┤
 * │                                                                  │
 * │  ┌─────────────────┐     ┌─────────────────┐                    │
 * │  │   Redis Cache   │     │  PostgreSQL     │                    │
 * │  │   (TTL: 5min)   │     │  (Hot: 30 days) │                    │
 * │  │                 │     │                 │                    │
 * │  │  • Rules cache  │     │  • Conversations│                    │
 * │  │  • Presence     │     │  • IMMessages   │                    │
 * │  │  • Pace state   │     │  • Receipts     │                    │
 * │  │  • Typing       │     │  • Consent      │                    │
 * │  │  • Seq counters │     │  • AuditLog     │                    │
 * │  └─────────────────┘     └────────┬────────┘                    │
 * │                                   │                              │
 * │                                   │ Migration Job                │
 * │                                   │ (30+ day old messages)       │
 * │                                   ▼                              │
 * │                          ┌─────────────────┐                    │
 * │                          │  S3 / Glacier   │                    │
 * │                          │  (Cold Storage) │                    │
 * │                          │                 │                    │
 * │                          │  • Archived msgs│                    │
 * │                          │  • Exports      │                    │
 * │                          │  • Audit backup │                    │
 * │                          └─────────────────┘                    │
 * │                                                                  │
 * └──────────────────────────────────────────────────────────────────┘
 * 
 * ═══════════════════════════════════════════════════════════════════
 *  LAYER 1: Redis (Sub-second access)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Purpose: Real-time state, ephemeral data, rate limiting
 * 
 * | Key Pattern              | TTL    | Purpose                     |
 * |--------------------------|--------|-----------------------------|
 * | im:presence:{userId}     | 5min   | Online status + heartbeat   |
 * | im:pace:{sender}:{recv}  | 24h    | Token bucket rate limiting  |
 * | im:typing:{conv}:{user}  | 5sec   | Typing indicator (auto-exp) |
 * | im:rules:{userId}        | 5min   | Power Board rules cache     |
 * | im:seq:{convId}          | 30d    | Sequence counter            |
 * | im:conn:{connId}         | 2h     | WS connection mapping       |
 * | im:delivery:{userId}     | 1h     | Pending delivery queue      |
 * | im:consent:{g}:{g}:{t}   | 10min  | Consent grant cache         |
 * 
 * ═══════════════════════════════════════════════════════════════════
 *  LAYER 2: PostgreSQL — Hot (Recent 30 days)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Purpose: Active conversation data, queryable messages
 * 
 * | Table                    | Retention | Notes                       |
 * |--------------------------|-----------|-----------------------------|
 * | Conversation             | Permanent | Active conversations only   |
 * | ConversationParticipant  | Permanent | Per-user state              |
 * | IMMessage                | 30 days   | Recent messages (hot)       |
 * | MessageReceipt           | 30 days   | Delivery & read receipts    |
 * | ConsentRequest           | 30 days   | Pending/expired requests    |
 * | ConsentGrant             | Permanent | Active grants               |
 * | PowerBoardRule           | Permanent | User rules                  |
 * | AuditLog                 | 90 days   | Compliance audit trail      |
 * | UserPresence             | Permanent | Last known status           |
 * 
 * Query Optimization:
 * - IMMessage: Composite index (conversationId, seq) for range scans
 * - MessageReceipt: Composite index (userId, readAt) for unread queries
 * - Conversation: Partial index on (state = 'ACTIVE') for active list
 * - AuditLog: Composite index (userId, createdAt) for per-user history
 * 
 * ═══════════════════════════════════════════════════════════════════
 *  LAYER 3: S3 / Glacier — Cold (30+ day old messages)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Purpose: Long-term archival, compliance, data export
 * 
 * Migration Job (runs daily via Vercel Cron):
 * 
 *   1. SELECT conversations WHERE lastMessageAt < NOW() - 30 days
 *   2. For each conversation:
 *      a. Export messages older than 30 days → S3 JSON
 *      b. Create S3 object: im-archive/{convId}/{dateRange}.json.gz
 *      c. Mark migrated messages as isArchived = true
 *      d. Update conversation.stats.archivedMessageCount
 *   3. After 7-day grace period, DELETE archived messages from PostgreSQL
 *   4. Keep Conversation, ConsentGrant, AuditLog records permanently
 * 
 * Cold Storage Structure:
 *   s3://lokfeel-im-archive/
 *     └── {convId}/
 *         ├── 2026-03.json.gz     # Messages from March 2026
 *         ├── 2026-04.json.gz     # Messages from April 2026
 *         └── metadata.json       # Conversation metadata
 * 
 * Retrieval (on-demand):
 *   - User requests old messages → API loads from S3 → returns to client
 *   - Expected latency: 1-5 seconds (S3 Standard)
 *   - Glacier retrieval: 1-5 minutes (for very old archives)
 * 
 * ═══════════════════════════════════════════════════════════════════
 *  MIGRATION CRON JOB
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Schedule: Daily at 3:00 AM UTC
 * Endpoint: POST /api/cron/im-migrate-cold-storage
 * 
 * Steps:
 *   1. Find conversations with messages older than 30 days
 *   2. Batch export to S3 (100 conversations per run max)
 *   3. Mark exported messages in DB
 *   4. After 7-day grace: hard delete from PostgreSQL
 *   5. Report stats to monitoring
 * 
 * ═══════════════════════════════════════════════════════════════════
 *  COMPLIANCE & DATA RETENTION
 * ═══════════════════════════════════════════════════════════════════
 * 
 * - CCPA: Users can export all data via /api/im/export
 * - Crypto-Shred: Account deletion permanently destroys encryption keys
 * - Audit Log: 90-day retention, then archived to Glacier
 * - Consent Records: Permanent (legal requirement)
 * - Messages: 30-day hot + indefinite cold storage
 * 
 * ═══════════════════════════════════════════════════════════════════
 *  ESTIMATED COSTS (3500 users, ~100 daily active)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * | Component          | Monthly Estimate                    |
 * |--------------------|-------------------------------------|
 * | Upstash Redis      | ~$0.50 (free tier covers 10K cmds)  |
 * | Neon PostgreSQL    | ~$0.00 (free tier: 0.5GB)           |
 * | S3 Storage         | ~$0.10 (estimated 1GB cold)         |
 * | S3 Requests        | ~$0.01                              |
 * | ────────────────── | ─────────────────────────────────── |
 * | TOTAL              | ~$0.61/month                        |
 */

// This file serves as documentation. The actual migration cron job
// should be implemented in /api/cron/im-migrate-cold-storage/route.ts

export const STORAGE_CONFIG = {
  hot: {
    retentionDays: 30,
    tables: ['IMMessage', 'MessageReceipt', 'ConsentRequest'],
  },
  warm: {
    retentionDays: 90,
    tables: ['AuditLog'],
  },
  cold: {
    bucket: process.env.S3_ARCHIVE_BUCKET || 'lokfeel-im-archive',
    prefix: 'im-archive',
    format: 'json.gz',
  },
  migration: {
    batchSize: 100,
    gracePeriodDays: 7,
    scheduleCron: '0 3 * * *', // Daily at 3 AM UTC
  },
} as const;
