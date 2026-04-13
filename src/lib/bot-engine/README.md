# LokFeel Bot Behavior Engine — Architecture Document

## Overview

The Bot Behavior Engine simulates realistic user behavior for LokFeel's digital (bot) users. Each bot has a unique personality type that drives its online patterns, browsing habits, match decisions, and chat behavior. The system uses seeded random number generators for deterministic, reproducible behavior.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       BotEngine                              │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Online     │  │  Browsing    │  │   Match      │      │
│  │   Status     │  │  Module      │  │   Response   │      │
│  │   Module     │  │              │  │   Module     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Chat       │  │   Logger     │  │   Config     │      │
│  │   Module     │  │   Module     │  │   System     │      │
│  │              │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                         │                                    │
│                   ┌─────┴─────┐                              │
│                   │  Prisma   │                              │
│                   │  Adapter  │                              │
│                   └───────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
nexus-app/src/lib/bot-engine/
├── index.ts                      # Main exports
├── types.ts                      # Type definitions
├── config.ts                     # Personality presets & factory
├── utils.ts                      # Seeded PRNG & distributions
├── modules/
│   ├── index.ts                  # Module re-exports
│   ├── online-status.ts          # Online/offline simulation
│   ├── browsing.ts               # Profile browsing simulation
│   ├── match-response.ts         # Match accept/reject logic
│   ├── chat.ts                   # Chat message generation
│   └── logger.ts                 # Event logging & monitoring
├── schedulers/
│   ├── engine.ts                 # Core BotEngine orchestrator
│   └── prisma-adapter.ts         # Prisma DB adapter
└── templates/
    └── chat-templates.ts         # Conversation template library
```

## Personality System

6 personality types drive all behavior parameters:

| Type | Sessions/Day | Accept Rate | Chat Speed | Description |
|------|-------------|-------------|------------|-------------|
| `explorer` | 4 | 55% | 15min avg | Active swiper, many matches |
| `selective` | 2 | 30% | 20min avg | Careful reviewer, few but high-quality |
| `social` | 5 | 65% | 8min avg | Frequent chatter, engages deeply |
| `passive` | 1 | 40% | 90min avg | Checks occasionally, slow responder |
| `enthusiastic` | 6 | 70% | 3min avg | Super likes, quick responses |
| `cautious` | 2 | 25% | 45min avg | Takes time, reads everything |

Gender adjustments are layered on top:
- **Male**: +10% sessions, +10% accept, +15% initiative, 0.8x response time
- **Female**: -10% sessions, -10% accept, -10% initiative, 1.1x response time
- **Non-binary**: Neutral baseline

## Module Details

### 1. Online Status Module (`online-status.ts`)

Simulates realistic online patterns:
- **Timezone-aware peak hours**: Each personality has defined peak hours (e.g., 20-23)
- **Day-of-week patterns**: Some personalities are more active on certain days
- **Session management**: Log-normal session duration distribution (most sessions shorter than average)
- **Transition probability**: `calculateOnlineProbability()` returns 0-1 based on time + personality

Key functions:
- `calculateOnlineProbability(config, timezone)` → probability of being online now
- `evaluateOnlineTransition(state, config, timezone)` → new state + events
- `estimateNextSessionDelay(config, timezone)` → minutes until next session

### 2. Browsing Module (`browsing.ts`)

Simulates profile viewing behavior:
- **Browse count**: Normal distribution around personality's `avgProfilesPerSession`
- **Dwell time**: Normal distribution, detailed views take 2x longer
- **Revisit behavior**: Configurable probability of revisiting previously viewed profiles
- **Session fatigue**: Browse probability decreases as session progresses

Key functions:
- `simulateBrowseSession(config, botUserId, profileIds, previousIds)` → batch of view events
- `generateSingleProfileView(config, botUserId, profileId)` → single view event
- `shouldBrowseNow(config, minutesIntoSession, expectedDuration)` → boolean

### 3. Match Response Module (`match-response.ts`)

Decision engine for match reactions:
- **Sigmoid-based scoring**: `acceptProbability = sigmoid(score × weight)` blended with base probability
- **Decision flow**: Ghost check → Super Like check → Accept/Reject/Maybe
- **Response delay**: Log-normal distribution (most responses within mean, long tail)
- **Score thresholds**: Super Like requires ≥65-90 depending on personality

Decision logic:
```
1. Ghost? (passive: 35%, social: 8%) → never respond
2. Super Like? (score ≥ threshold && random < probability) → fast accept
3. Accept? (sigmoid probability) → delay based on score
4. Reject → polite delay
```

### 4. Chat Module (`chat.ts`)

Natural conversation simulation:
- **Template selection**: Personality maps to greeting/response style preferences
- **Message types**: greeting, response, question, compliment, share, follow_up, closing
- **Response timing**: Log-normal distribution with type-specific adjustments
- **Conversation lifecycle**: Opening → Developing → Engaging → Closing

Template system:
- 5 greeting styles: casual, direct, thoughtful, playful, warm
- 6 response styles: agree, interested, share, differ, playful, empathetic
- Context-aware placeholder filling: `{name}`, `{shared_topic}`, `{shared_value}`

### 5. Logger Module (`logger.ts`)

Centralized monitoring system:
- **Ring buffer**: Last 10,000 events kept in memory
- **Per-bot stats**: Total events, match reactions, messages sent, profiles viewed
- **Anomaly detection**: Excessive activity, high error rates
- **Health summary**: Uptime, events/minute, error rate, buffer usage
- **Persistence queue**: Batch DB writes of behavior events

## Engine Scheduler (`engine.ts`)

The `BotEngine` class orchestrates everything on a tick loop:

```
tick() {
  1. processOnlineTransitions()  — Go online/offline based on time
  2. processScheduledActions()   — Execute due actions (match reactions, messages)
  3. processBrowsingSessions()   — Active bots browse profiles
  4. processMatchReactions()     — Review pending matches, schedule reactions
  5. processChatResponses()      — Generate and schedule chat messages
  6. detectAnomalies()           — Check for unusual behavior
}
```

### Configuration

```typescript
const engineConfig: EngineConfig = {
  tickIntervalMs: 60_000,      // Check every minute
  maxActionsPerTick: 100,      // Process up to 100 actions per tick
  speedMultiplier: 1,          // 1 = real-time, 10 = 10x speed
  enableLogging: true,
  maxConcurrentSessions: 50,
  minActionIntervalMs: 5_000,  // 5s minimum between actions per bot
};
```

### Action Scheduling

Match reactions and chat messages aren't executed immediately. They're scheduled with:
- **Priority**: 1 (Super Like) → 2 (match reactions) → 3 (chat) → 5 (ghost)
- **Delay**: Based on personality response time, divided by speed multiplier
- **Retry**: Up to `maxRetries` with exponential backoff

## Database Integration (`prisma-adapter.ts`)

The `BotEngineDbAdapter` interface defines 8 methods:

| Method | Purpose |
|--------|---------|
| `loadBotUsers()` | Load all bot users from DB |
| `updateOnlineStatus()` | Track online/offline in analytics |
| `getBrowsableProfiles()` | Get profiles for browsing |
| `getPreviouslyViewedProfiles()` | Track viewed profiles |
| `recordProfileViews()` | Log profile views |
| `getPendingMatches()` | Get matches needing response |
| `submitMatchReaction()` | Submit accept/reject/maybe |
| `getPendingChatResponses()` | Get chat rooms needing response |
| `sendChatMessage()` | Create message in chat room |

The Prisma adapter maps to existing schema:
- `User.isBot`, `User.botConfig` → bot identification
- `Match.senderAction/receiverAction` → reaction storage
- `MatchReaction` → detailed reaction records
- `AnalyticsEvent` → behavior event persistence
- `Message` → chat message creation

## Seeded Randomness

All randomness uses **Mulberry32 PRNG** seeded per bot:
```typescript
const random = createSeededRandom(hashStringToSeed(botUserId));
```

This ensures:
- Same bot always produces same behavior for same inputs
- Reproducible for debugging
- Deterministic across restarts (within same tick boundaries)

## Quick Start

```typescript
import { BotEngine, createPrismaAdapter, DEV_ENGINE_CONFIG } from '@/lib/bot-engine';
import { PrismaClient } from '@/generated';

const prisma = new PrismaClient();
const engine = new BotEngine(
  createPrismaAdapter(prisma),
  DEV_ENGINE_CONFIG,  // Faster for development
);

// Start the engine
await engine.start();

// Check health
const health = engine.getHealth();
console.log(health);

// Stop when done
engine.stop();
```

## Monitoring & Debugging

```typescript
// Get global stats
const stats = engine.getHealth();

// Get specific bot stats
const botStats = engine.getBotBehaviorStats('bot_user_id');

// Get recent events
const events = engine.logger.getRecentEvents(50);

// Get anomalies
const anomalies = engine.logger.detectAnomalies();
```
