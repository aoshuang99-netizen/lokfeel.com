# LokFeel Nexus-App Database & API Performance Audit Report

> **Audit Date:** 2026-05-09
> **Tech Stack:** Next.js 16 + Prisma 7 + Turso libSQL (SQLite) + NextAuth v5
> **Auditor:** CodeBuddy AI Performance Audit

---

## Executive Summary

| Severity | Count |
|----------|-------|
| **Critical** | 5 |
| **High** | 12 |
| **Medium** | 16 |
| **Low** | 8 |

**Top Risks:**
1. Prisma client eagerly instantiated at module scope in `/api/bots/status/route.ts`, bypassing the lazy singleton pattern.
2. N+1 query patterns in chat list and batch operations causing O(n) database round-trips.
3. Multiple `groupBy` calls on Turso/libSQL, which has limited support and can cause 500 errors.
4. Race condition in IM message sequence number generation — concurrent sends can assign duplicate `seq` values.
5. Missing `notIn` exclusion of blocked users across discover/match/chat APIs.

---

## 1. Prisma Schema Audit

### [Medium] M-01: Missing `@@index` on frequently queried `Match.senderAction` / `Match.receiverAction`

**File:** `prisma/schema.prisma:540-552`

The `who-liked-me` API and match filtering query `Match.senderAction` directly:

```prisma
// schema.prisma:136
where: {
  receiverId: user.id,
  senderAction: 'INTERESTED',
  ...
}
```

But there is **no index** on `senderAction` or `receiverAction`. On Turso (SQLite), this causes a full table scan.

**Fix:**
```prisma
@@index([senderAction])
@@index([receiverAction])
```

---

### [Medium] M-02: Missing composite index on `Profile(profileStatus, gender)`

**File:** `prisma/schema.prisma:467-473`

The `discover` and `square` APIs filter by both `profileStatus` and `gender` simultaneously:

```typescript
// discover/route.ts:86-111
profile: {
  is: {
    onboardingStep: { gte: minOnboardingStep },
    gender: targetGender,
  },
}
```

Separate single-column indexes exist (`@@index([gender])`, `@@index([profileStatus])`) but SQLite benefits from a composite index.

**Fix:**
```prisma
@@index([profileStatus, gender])
```

---

### [Medium] M-03: `Account` table missing `userId` index

**File:** `prisma/schema.prisma:334-351`

`Account` has `@@unique([provider, providerAccountId])` but no index on `userId`. While the `onDelete: Cascade` relationship exists, any query filtering accounts by `userId` (e.g., session cleanup) requires a full scan.

**Fix:**
```prisma
@@index([userId])
```

---

### [Low] L-01: `Session` table missing `userId` index

**File:** `prisma/schema.prisma:353-360`

Similar to `Account`, the `Session` model lacks an explicit index on `userId` beyond the `sessionToken @unique`.

**Fix:**
```prisma
@@index([userId])
```

---

### [Low] L-02: `Payment` uses `Float` for monetary amounts

**File:** `prisma/schema.prisma:1096`

```prisma
amount Float // In USD
```

`Float` introduces floating-point precision errors (e.g., `19.99` may become `19.989999...`). Should use `Int` representing cents (like `PLAN_CONFIG.amount: 1999` in the checkout route already does).

**Fix:** Migrate to `Int` with cents, or at minimum ensure all comparisons use epsilon-based equality.

---

### [Low] L-03: `SincerityTransaction.amount` can be negative

**File:** `prisma/schema.prisma:1609`

```prisma
amount Int
```

The `SPEND` type passes `amount: -EXTENSION_COST`. This is fragile — negative amounts in transaction logs can cause aggregation bugs (e.g., `SUM(amount)` returning incorrect totals). Better to always store positive amounts and derive sign from `type`.

---

## 2. API Route Performance Audit

### [Critical] C-01: N+1 queries in `/api/chat` GET — two sequential `findMany` with deep includes

**File:** `src/app/api/chat/route.ts:14-137`

**Performance Impact:** O(n) DB round-trips for each chat room's messages, members, and match data.

```typescript
// Line 14-55: First query — ChatRoom system
const memberships = await db.chatRoomMember.findMany({
  where: { userId: user.id },
  include: {
    room: {
      include: {
        match: { include: { sender, receiver } },   // N includes
        members: { include: { user: { include: { profile } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { ... } } } },
      },
    },
  },
})

// Line 97-137: Second query — IM Conversations
const imConversations = await db.conversation.findMany({
  where: { OR: [...] },
  include: {
    userA: { select: { ..., profile: { select: { ... } } } },
    userB: { select: { ..., profile: { select: { ... } } } },
    imMessages: { orderBy: { createdAt: 'desc' }, take: 1 },
  },
})
```

**Problem:** Both queries fetch ALL conversations without pagination. A user with 100 conversations triggers two heavy queries. The `_count` sub-select inside `include` for each room is also a hidden N+1.

**Fix:**
1. Add `take: 50` with cursor-based pagination for both queries.
2. Use `_count` at the top level instead of nested inside `include`.
3. Consider using `select` instead of `include` to only fetch needed fields.

---

### [Critical] C-02: Race condition in IM message `seq` generation

**File:** `src/app/api/im/send/route.ts:52-57`

```typescript
const lastMessage = await prisma.iMMessage.findFirst({
  where: { conversationId },
  orderBy: { seq: "desc" },
  select: { seq: true },
});
const nextSeq = (lastMessage?.seq || 0) + 1;
```

**Problem:** Between the `findFirst` and `create`, another concurrent request can read the same `seq`. Two messages end up with identical `seq` values, breaking message ordering. This is a classic TOCTOU (time-of-check/time-of-use) race.

**Fix:**
Use a database-level approach:
```typescript
// Option A: Use raw SQL with atomic increment (if supported by libSQL)
// Option B: Use a conversation-level mutex/lock
// Option C: Use createdAt-based ordering instead of seq for display
```

The same bug exists in:
- `src/app/api/chat/[id]/messages/route.ts:357-362` (ChatRoom POST)
- `src/app/api/chat/[id]/messages/route.ts:402-407` (Bot reply seq)
- `src/app/api/auto-match/route.ts:267` (hardcoded `seq: 1`)

---

### [Critical] C-03: Prisma client eagerly instantiated at module scope

**File:** `src/app/api/bots/status/route.ts:11`

```typescript
const prisma = getDb();
```

**Problem:** `getDb()` is called at module evaluation time, not inside the handler. This:
1. Defeats the lazy singleton pattern in `db.ts` (the Proxy-based lazy init).
2. In cold starts (Vercel Serverless), this can fail if `DATABASE_URL` isn't available yet.
3. Creates the PrismaClient + Turso adapter before the request handler runs.

**Fix:** Move inside the handler:
```typescript
export async function GET(req: NextRequest) {
  const prisma = getDb(); // or just use `db` from imports
  ...
}
```

---

### [Critical] C-04: `groupBy` calls on Turso/libSQL will fail

**File:** `src/app/api/bots/status/route.ts:30-49`

```typescript
prisma.botInteractionLog.groupBy({
  by: ['botProfileId' as any],
  where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  _count: true
})
```

**Problem:** The codebase already documented in `/api/chats/route.ts:11-12` that Turso/libSQL has limited `groupBy` support. Yet `bots/status` uses `groupBy` twice, and `admin/analytics` and `matches/inbox` also use it. These will intermittently throw 500 errors.

**Also affected:**
- `src/app/api/admin/analytics/route.ts:63,77-78`
- `src/app/api/admin/fix-onboarding/route.ts:90`
- `src/app/api/matches/inbox/route.ts:136`

**Fix:** Replace `groupBy` with individual queries or `$queryRaw` with raw SQL that SQLite supports natively:
```typescript
// Instead of groupBy, use:
const logs = await prisma.botInteractionLog.findMany({
  where: { createdAt: { gte: ... } },
  select: { botProfileId: true },
  distinct: ['botProfileId'],
});
const count = logs.length;
```

---

### [Critical] C-05: No `where` filter on `Square` API `findMany` — potential full table scan

**File:** `src/app/api/square/route.ts:148-165`

```typescript
const candidates = await db.profile.findMany({
  where: baseWhere,  // Only filters by userId and profileStatus
  include: {
    user: { select: { id, name, createdAt, isBot, _count: { ... } } },
    botProfile: true,
  },
  take: 100, // Fetches 100 records for in-memory sorting
});
```

**Problem:** With `take: 100` and broad `where` clause, this fetches 100 profiles with full includes, then does all match score calculation **in-memory** in a `map()`. For each of the 100 candidates, `calculateEnhancedMatchScore` runs in JavaScript. This is CPU-intensive and slow.

**Fix:** Push filtering to the database with tighter `where` clauses, or implement a pre-computed score cache (the `compatibilityScore` field on `Profile` exists but is unused here).

---

### [High] H-01: N+1 queries in `/api/chats` GET — per-room unread count

**File:** `src/app/api/chats/route.ts:80-107`

```typescript
const countPromises = chatRooms.map(async (room) => {
  const count = await prisma.message.count({
    where: {
      roomId: room.id,
      senderId: { not: userId },
      isRead: false,
    },
  });
  ...
});
const results = await Promise.all(countPromises);
```

**Problem:** Although parallelized, this fires N separate `COUNT` queries (one per chat room). For a user with 50 chat rooms, this is 50 database round-trips.

**Fix:** Use a single aggregated query:
```typescript
const unreadCounts = await prisma.message.groupBy({
  by: ['roomId'],
  where: { senderId: { not: userId }, isRead: false },
  _count: { id: true },
});
// Map to roomId -> count
```
(Or use `$queryRaw` since `groupBy` may fail on Turso.)

---

### [High] H-02: N+1 in batch match operations (`inbox` POST)

**File:** `src/app/api/matches/inbox/route.ts:242-274`

```typescript
case 'accept':
  for (const match of matches) {
    const chatRoom = await db.chatRoom.create({ ... });
    await db.match.update({ ... });
    if (match.giftAmount > 0) {
      await processGiftTransaction(match, userId); // 3-4 more queries
    }
  }
```

**Problem:** Sequential loop with 3-7 DB queries per match. Accepting 10 matches = 30-70 sequential DB calls.

**Fix:** Use `createMany` and `updateMany` where possible, and wrap the entire batch in a `$transaction`.

---

### [High] H-03: Auto-match creates records in sequential loop — N*6 queries

**File:** `src/app/api/auto-match/route.ts:180-321`

```typescript
for (const botUser of botUsers) {
  const match = await prisma.match.create({ ... });        // +1
  const existingConv = await prisma.conversation.findFirst({ ... }); // +1
  const conversation = await prisma.conversation.create({ ... });   // +1
  const existingChatRoom = await prisma.chatRoom.findFirst({ ... }); // +1
  const chatRoom = await prisma.chatRoom.create({ ... });   // +1
  await prisma.chatRoomMember.createMany({ ... });           // +1
  await prisma.iMMessage.create({ ... });                    // +1
  await prisma.conversation.update({ ... });                 // +1
  await prisma.message.create({ ... });                      // +1
  await prisma.chatRoom.update({ ... });                     // +1
}
```

**Problem:** Creating 5 matches = 50 sequential queries. Each iteration is 10 queries. Should be wrapped in a transaction and parallelized where possible.

**Fix:** Use `prisma.$transaction([...])` with all creates, and pre-compute existence checks in a single query.

---

### [High] H-04: `/api/discover` loads all match history into memory

**File:** `src/app/api/discover/route.ts:42-77`

```typescript
const existingMatches = await prisma.match.findMany({
  where: { OR: [{ senderId }, { receiverId }] },
  select: { senderId: true, receiverId: true },
});

const existingReactions = await prisma.matchReaction.findMany({
  where: { userId },
  include: { match: { select: { senderId: true, receiverId: true } } },
});
```

**Problem:** Loads the entire match and reaction history for the user into memory to compute `excludeIds`. For active users with thousands of matches/reactions, this is expensive. The reaction query uses `include` when `select` would suffice.

**Fix:**
1. Use `select` instead of `include` for reactions.
2. Use `distinct` on senderId/receiverId to reduce payload.
3. Consider a Redis cache or a materialized "excluded users" list.

---

### [High] H-05: `/api/chat/[id]/messages` POST has redundant DB queries

**File:** `src/app/api/chat/[id]/messages/route.ts:248-285`

```typescript
// Already fetched user data at line 221
const userProfile = await db.profile.findUnique({ where: { userId: user.id } });

// Then again at line 248
const userWithSub = await db.user.findUnique({
  where: { id: user.id },
  include: { subscriptions: { ... }, profile: { ... } },
});

// And AGAIN at line 274
const userRecord = await db.user.findUnique({
  where: { id: user.id },
  select: { cardVerified: true },
});
```

**Problem:** The user's profile is queried 3 times in a single request (lines 221, 248, 274). The subscription data could be fetched once and reused.

**Fix:** Fetch all needed data in a single query at the start:
```typescript
const [userProfile, userWithSub] = await Promise.all([
  db.profile.findUnique({ where: { userId: user.id } }),
  db.user.findUnique({
    where: { id: user.id },
    include: {
      subscriptions: { where: { status: 'ACTIVE' }, take: 1 },
      profile: { select: { gender: true } },
    },
  }),
]);
```

---

### [High] H-06: Bot reply seq duplication in `/api/chat/[id]/messages`

**File:** `src/app/api/chat/[id]/messages/route.ts:402-407`

```typescript
const lastBotMsg = await db.iMMessage.findFirst({
  where: { conversationId: roomId },
  orderBy: { seq: 'desc' },
  select: { seq: true },
});
const botSeq = (lastBotMsg?.seq || 0) + 1;
```

**Problem:** After the user's message was just created with `nextSeq`, the bot reply reads `lastMessage` again. But the user's message was created in the same request, so `lastBotMsg` will find the user's message (which has the highest seq), and `botSeq = nextSeq + 1`. This is correct **only** if no other request intervenes. In practice, with bot auto-replies via `/api/im/send` + `handleBotReply`, the same race condition as C-02 applies.

**Fix:** Use `nextSeq + 1` directly instead of re-querying, or use a transaction.

---

### [High] H-07: `/api/notifications` GET returns all fields without `select`

**File:** `src/app/api/notifications/route.ts:22-26`

```typescript
const notifications = await db.notification.findMany({
  where,
  orderBy: { createdAt: 'desc' },
  take: limit,
});
```

**Problem:** Returns all fields from the `Notification` model. As the `data` field contains arbitrary JSON and `body` can be large, this transfers unnecessary data.

**Fix:** Add `select` to only return needed fields:
```typescript
select: {
  id: true, type: true, title: true, body: true,
  data: true, actionUrl: true, isRead: true, readAt: true, createdAt: true,
}
```

---

### [High] H-08: `/api/activity` GET has no pagination beyond `take: 50`

**File:** `src/app/api/activity/route.ts:30-92`

```typescript
const receivedMatches = await prisma.match.findMany({
  ...
  take: 50,
});
const matches = await prisma.match.findMany({
  ...
  take: 50,
});
```

**Problem:** Always fetches 50 of each type, merges in-memory, then slices to 50. With offset/cursor missing, users can never load more activity.

**Fix:** Add `offset`/`cursor` parameters or implement cursor-based pagination.

---

### [High] H-09: Duplicate chat list endpoints without shared logic

**Files:**
- `src/app/api/chat/route.ts` (returns merged ChatRoom + IM)
- `src/app/api/chats/route.ts` (returns ChatRoom only)
- `src/app/api/im/conversations/route.ts` (returns IM only)

**Problem:** Three different endpoints serve overlapping chat list data. Frontend may call multiple, wasting bandwidth and causing inconsistent state. Each implements its own query logic with slightly different field selections.

**Fix:** Consolidate to a single `/api/chats` endpoint with a `?source=all|chatroom|im` parameter.

---

### [High] H-10: Missing `select` in multiple admin APIs

**File:** `src/app/api/admin/settings/route.ts:22`

```typescript
const settings = await db.systemConfig.findMany();
```

No `select` — returns all fields including `updatedBy`. While admin-only, it's still wasteful.

**File:** `src/app/api/admin/rbac/roles/route.ts:33`

```typescript
const customRoles = await db.customRole.findMany({});
```

No `where` filter (returns all custom roles) and no pagination.

---

### [High] H-11: `/api/profile` GET returns full profile without `select`

**File:** `src/app/api/profile/route.ts:29-31`

```typescript
const profile = await db.profile.findUnique({
  where: { userId: user.id },
})
```

**Problem:** Returns ALL profile fields including `adminNotes`, `personalityData` (large JSON), `kinkInterests`, `hardLimits`, and `dealbreakers`. The frontend likely doesn't need all of these on every profile load.

**Fix:** Use `select` to exclude sensitive/internal fields from the user-facing response.

---

### [High] H-12: `/api/payments/status` has 4 sequential queries, 2 redundant

**File:** `src/app/api/payments/status/route.ts:14-34`

```typescript
const [subscription, profile, recentPayments] = await Promise.all([
  db.subscription.findFirst({ ... }),
  db.profile.findFirst({ where: { userId: user.id }, select: { gender: true } }),
  db.payment.findMany({ ... }),
]);

// Then a 4th query AFTER the Promise.all:
const userRecord = await db.user.findUnique({
  where: { id: user.id },
  select: { cardVerified: true },
});
```

**Problem:** `cardVerified` is on the `User` model, not `Profile`. The user session already has `user.id`, so this could be merged into the `Promise.all` by also fetching from `User`. But more importantly, the `requireAuth()` call already fetches the user — `cardVerified` could be included there.

**Fix:** Add `cardVerified` to the auth session or include it in the initial `Promise.all` by querying `User` instead of a separate call.

---

### [Medium] M-04: `/api/matches/weekly` GET has no pagination

**File:** `src/app/api/matches/weekly/route.ts:22-42`

```typescript
const matches = await db.match.findMany({
  where: { OR: [...], createdAt: { gte: startOfWeek, lt: endOfWeek } },
  include: { sender: {...}, receiver: {...} },
  orderBy: { createdAt: "desc" },
  // NO take/skip!
});
```

**Problem:** No `take` limit. A power user with hundreds of weekly matches gets all of them.

---

### [Medium] M-05: `calculateMatchScore` duplicated 4 times across codebase

**Files:**
- `src/app/api/discover/route.ts:242-300`
- `src/app/api/matches/react/route.ts:220-299`
- `src/app/api/auto-match/route.ts:333-377`
- `src/lib/matching/engine.ts` (imported by some routes)

**Problem:** Four different implementations of match score calculation with slightly different logic. This leads to inconsistent scores between discover, react, and auto-match.

**Fix:** All routes should import from `@/lib/matching/engine` (which already exists) and delete the local implementations.

---

### [Medium] M-06: `/api/discover` gender filtering logic is fragile

**File:** `src/app/api/discover/route.ts:96-112`

```typescript
const preferredGender = profile.preferredGender?.toUpperCase() || null;
if (preferredGender && preferredGender !== "EVERYONE") {
  const genderMap: Record<string, string> = {
    'MALE': 'MALE', 'MAN': 'MALE',
    'FEMALE': 'FEMALE', 'WOMAN': 'FEMALE',
  };
  const targetGender = genderMap[preferredGender];
  // Only maps 4 values — misses TRANSGENDER_MAN, NON_BINARY, etc.
}
```

**Problem:** The expanded `Gender` enum has 18 values but the map only handles 4. Users who prefer non-binary partners get all genders (effectively "EVERYONE").

---

### [Medium] M-07: `/api/matches/[id]` POST checks auth but not membership

**File:** `src/app/api/matches/[id]/route.ts:128-138`

```typescript
const match = await db.match.findUnique({ where: { id } });
if (!match) return 404;
if (match.senderId !== user.id && match.receiverId !== user.id) return 403;
```

**Problem:** Uses `findUnique` (primary key lookup) then checks ownership. This is correct but fetches the full match with all fields. Could use `findFirst` with the ownership check built into `where`.

---

### [Medium] M-08: Inconsistent auth patterns across routes

**Files:**
- Some routes use `requireAuth()` from `@/lib/auth`
- Some use `auth()` from `@/lib/auth`
- Some use `requireAuth()` from `@/lib/auth/auth`
- Some use `requireVerifiedUser()`

```typescript
// chat/route.ts
import { requireAuth } from '@/lib/auth'

// chats/route.ts
import { auth } from "@/lib/auth"

// profile/[userId]/route.ts
import { requireAuth } from "@/lib/auth/auth"

// im/send/route.ts
import { auth } from "@/lib/auth"
```

**Problem:** Three different import paths for auth. `requireAuth` throws on failure (caught by `handleApiError`), while `auth()` returns null (requires manual null check). This inconsistency makes it easy to introduce auth bypass bugs.

---

### [Medium] M-09: `/api/chat/[id]` GET uses `Math.random()` for `isOnline`

**File:** `src/app/api/chat/[id]/route.ts:74`

```typescript
isOnline: isBot || Math.random() > 0.5, // Bots are always "online"
```

**Problem:** `isOnline` is randomized on every API call. This means the same user appears "online" and "offline" on successive requests. This is clearly a placeholder that was never replaced with real presence data.

**Fix:** Use the `UserPresence` table or `presenceManager` (already implemented in `@/lib/im`).

---

### [Medium] M-10: `/api/im/messages/[conversationId]` has inefficient polling with `after` param

**File:** `src/app/api/im/messages/[conversationId]/route.ts:46-55`

```typescript
if (after) {
  const afterMsg = await prisma.iMMessage.findUnique({
    where: { id: after },
    select: { createdAt: true },
  });
  if (afterMsg) {
    where.createdAt = { gt: afterMsg.createdAt };
  }
}
```

**Problem:** For polling, every request does an extra `findUnique` to convert message ID to timestamp. Two queries per poll instead of one.

**Fix:** Accept `afterSeq` as a parameter and filter by `seq: { gt: afterSeq }` directly (avoids the lookup query).

---

### [Medium] M-11: Vault extend operations are not atomic

**File:** `src/app/api/chat/[id]/vault/route.ts:166-197`

```typescript
// Step 1: Deduct sincerity points
await db.sincerityWallet.update({ ... });

// Step 2: Create transaction record
await db.sincerityTransaction.create({ ... });

// Step 3: Update chat room
await db.chatRoom.update({ ... });
```

**Problem:** Three sequential writes without a transaction. If step 2 or 3 fails, the user's points are deducted but the vault isn't extended. No rollback mechanism.

**Fix:** Wrap in `prisma.$transaction([...])`.

---

### [Medium] M-12: Missing input validation on several POST endpoints

**Files:**
- `/api/chat/[id]/messages` POST (line 233): No length limit on `content`
- `/api/im/send` POST (line 25): No content length limit
- `/api/matches/inbox` POST (line 209): No validation on `matchIds` array length (could be 1000+)

**Problem:** An attacker can send extremely large message content or batch operations, causing OOM or excessive DB writes.

**Fix:** Add Zod validation with reasonable limits:
```typescript
const body = z.object({
  content: z.string().max(5000),
}).parse(await request.json());
```

---

### [Medium] M-13: `/api/profile/[userId]` JSON.parse without try-catch

**File:** `src/app/api/profile/[userId]/route.ts:195-198`

```typescript
lifePriorities: profile.lifePriorities ? JSON.parse(profile.lifePriorities) : [],
boundaries: profile.boundaries ? JSON.parse(profile.boundaries) : [],
dealbreakers: profile.dealbreakers ? JSON.parse(profile.dealbreakers) : [],
```

**Problem:** If any JSON field is malformed, `JSON.parse` throws and the entire API returns 500.

**Fix:** Wrap in try-catch with fallback to `[]`.

---

### [Medium] M-14: `Payment.amount` comparison in checkout guard is incorrect

**File:** `src/app/api/payments/checkout/route.ts:68`

```typescript
if (existingSub && existingSub.plan === "PREMIUM_MONTHLY" || existingSub?.plan === "PREMIUM_YEARLY") {
```

**Problem:** Operator precedence bug. `&&` binds tighter than `||`, so this evaluates as:
```
(existingSub && existingSub.plan === "PREMIUM_MONTHLY") || (existingSub?.plan === "PREMIUM_YEARLY")
```

When `existingSub` is `null`, `existingSub?.plan` is `undefined`, so the second part is fine. But when `existingSub` exists with a different plan (e.g., `LADY_FREE`), the first part is `false` but the second part is also `false`, so it works by accident. However, the logic is confusing and fragile.

**Fix:** Add explicit parentheses:
```typescript
if (existingSub && (existingSub.plan === "PREMIUM_MONTHLY" || existingSub.plan === "PREMIUM_YEARLY")) {
```

---

### [Medium] M-15: `notification.data` stored as JSON string but no standardized access

Throughout the codebase, `data` field on `Notification` is stored as `JSON.stringify(...)`:
```typescript
data: JSON.stringify({ matchId: match.id }),
```

But there's no consistent pattern for parsing it on the client. Some places parse it, some don't.

---

### [Medium] M-16: `/api/who-liked-me` doesn't exclude blocked users

**File:** `src/app/api/who-liked-me/route.ts:13-40`

```typescript
const matches = await db.match.findMany({
  where: {
    receiverId: user.id,
    senderAction: 'INTERESTED',
    status: { notIn: ['ACCEPTED', 'REJECTED'] },
  },
  ...
});
```

**Problem:** Users you've blocked still appear in "who liked me". No filter for blocked users.

**Fix:** Add blocked user exclusion:
```typescript
const blockedUsers = await db.block.findMany({
  where: { blockerId: user.id },
  select: { blockedId: true },
});
const blockedIds = blockedUsers.map(b => b.blockedId);
// Add to where: { senderId: { notIn: blockedIds } }
```

---

### [Low] L-04: Excessive console.log in production code

**Files:** Multiple API routes

```typescript
// bot/chat/route.ts:321
console.log(`[Chat Bot Reply] ${botUser.id} replied to ${user.id}...`);

// discover/route.ts:155
console.log('[Discover API] Found users (first pass):', users.length);
```

**Problem:** While some are guarded by `NODE_ENV === 'development'`, many are not. In production on Vercel, these logs are visible and can leak user data.

---

### [Low] L-05: `/api/im/presence` POST uses dynamic import for `db`

**File:** `src/app/api/im/presence/route.ts:57`

```typescript
const { db } = await import('@/lib/db');
```

**Problem:** Dynamic import adds latency to every presence heartbeat. Should use the standard import at the top.

---

### [Low] L-06: `/api/chat/route.ts` and `/api/chats/route.ts` are nearly identical

Both return chat lists with slight differences. Frontend likely migrated from one to the other but both remain active.

---

### [Low] L-07: Inconsistent error response formats

```typescript
// Some return: { error: "..." }
// Some return: { message: "..." }
// Some return: success({ ... })  // from api-response helper
// Some return: NextResponse.json({ error: ... })
```

**Problem:** Frontend error handling must account for multiple formats.

---

### [Low] L-08: `BotInteractionLog.botUserId` references a field that doesn't exist

**File:** `src/app/api/bots/status/route.ts:31`

```typescript
prisma.botInteractionLog.groupBy({
  by: ['botProfileId' as any],  // Type assertion to bypass TS error
```

The `as any` type assertion suggests the field name may be wrong. The schema defines `botUserId` (line 116), not `botProfileId`.

---

## 3. Frontend-Backend Interaction Issues

### [Medium] M-17: Duplicate chat list APIs cause stale data

**Problem:** The app has 3 overlapping chat endpoints (`/api/chat`, `/api/chats`, `/api/im/conversations`). If the frontend calls different endpoints on different pages, cache invalidation becomes impossible and users see inconsistent unread counts.

**Fix:** Consolidate to one canonical endpoint.

---

### [Medium] M-18: `isOnline: false` hardcoded in multiple responses

**Files:**
- `src/app/api/chat/route.ts:80` — `isOnline: false`
- `src/app/api/chat/route.ts:157` — `isOnline: false`

The `UserPresence` system exists (`@/lib/im/presenceManager`) but is not used in chat list queries. Users always appear offline.

**Fix:** Batch-fetch presence status for all chat partners using `presenceManager.getPresenceBatch()`.

---

### [Medium] M-19: No optimistic update rollback mechanism visible

The chat send endpoints return the created message, but there's no evidence of optimistic update rollback logic if the API call fails. Frontend must handle this.

---

## 4. Database Connection and Configuration Audit

### [High] H-13: Prisma client initialization pattern is mostly correct but has gaps

**File:** `src/lib/db.ts:39-88`

**Good:**
- Lazy singleton via Proxy
- Global caching for hot reload
- `cleanLibsqlUrl()` strips PostgreSQL params
- Turso adapter correctly configured

**Issues:**
1. **No connection pool configuration:** The `PrismaLibSql` adapter is created without explicit pool settings. Turso recommends configuring `connectionLimit` for serverless environments.
2. **No query timeout:** Long-running queries can hang indefinitely.
3. **Dev logging includes `query`:** `log: ['query', 'error', 'warn']` in development logs ALL queries, which is very verbose and can slow things down.

**Fix:**
```typescript
const adapter = new PrismaLibSql({
  url,
  authToken: authToken || undefined,
  // Add Turso-specific connection pool settings
});
```

---

### [Low] L-09: `prisma.config.ts` reads from `dotenv/config` at build time

**File:** `prisma.config.ts:3`

```typescript
import "dotenv/config";
```

This works but `defineConfig` from Prisma 7 supports passing `url` directly without relying on dotenv.

---

## 5. Priority Fix Roadmap

### Phase 1 — Immediate (Critical)

| ID | Issue | Effort | Impact |
|----|-------|--------|--------|
| C-01 | N+1 in chat list | Medium | High latency for active users |
| C-02 | Seq race condition | Medium | Data corruption |
| C-03 | Eager Prisma init | Low | Cold start failures |
| C-04 | groupBy on Turso | Medium | 500 errors |
| C-05 | Square full table scan | Medium | Slow discover page |

### Phase 2 — Short-term (High)

| ID | Issue | Effort | Impact |
|----|-------|--------|--------|
| H-01 | N+1 unread counts | Medium | Chat list latency |
| H-02 | Batch match sequential | Medium | Admin batch operations |
| H-03 | Auto-match N*6 queries | Medium | Onboarding latency |
| H-05 | Redundant user queries | Low | Message send latency |
| H-09 | Duplicate chat APIs | Medium | Maintenance burden |
| H-12 | 4 queries for payment status | Low | Checkout latency |

### Phase 3 — Medium-term (Medium)

| ID | Issue | Effort | Impact |
|----|-------|--------|--------|
| M-01-M-03 | Missing indexes | Low | Query performance |
| M-05 | Duplicated score calc | Medium | Score consistency |
| M-08 | Auth import chaos | Medium | Security risk |
| M-11 | Non-atomic vault extend | Low | Data integrity |
| M-14 | Operator precedence bug | Low | Logic error |

---

## Appendix: Schema Index Coverage Matrix

| Model | Indexed Fields | Missing Indexes |
|-------|---------------|-----------------|
| User | email, role, createdAt, deletedAt | (sufficient) |
| Match | status, matchScore, matchType, createdAt, expiresAt, senderId, receiverId, isUnread, inboxPriority, deletedAt | **senderAction, receiverAction** |
| Profile | gender, relationshipGoal, profileStatus, compatibilityScore, linkedInVerified, isApproved | **profileStatus+gender (composite)** |
| Conversation | state, lastMessageAt, userAId, userBId, controllingUserId, vaultExpiresAt, deletedAt | (sufficient) |
| IMMessage | conversationId+seq, conversationId+createdAt, senderId, receiverId, clientMsgId, createdAt, msgType, isDeleted | (sufficient) |
| Account | provider+providerAccountId | **userId** |
| Session | sessionToken | **userId** |
| Notification | userId+isRead+createdAt | (sufficient) |
| BotInteractionLog | botUserId+createdAt, interactionType, outcome | (sufficient) |
