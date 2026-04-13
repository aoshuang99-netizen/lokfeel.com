# Bot Engine Cron Jobs — Environment Variables

## Required Environment Variables

### CRON_SECRET
Secret key for authenticating Vercel Cron Job requests.

**Format:** Random string (min 32 characters recommended)

**Example:**
```
CRON_SECRET=your_random_secret_key_here_min_32_chars
```

**How to set in Vercel:**
```bash
# Using Vercel CLI
vercel env add CRON_SECRET

# Or set via Vercel Dashboard
# Project → Settings → Environment Variables → Add New
```

**Verification:**
- Cron endpoints check for `Authorization: Bearer <CRON_SECRET>` header
- Requests without valid header receive 401 Unauthorized

---

## Optional Configuration

### BOT_ENGINE_ENABLED
Enable/disable bot engine processing (default: true)

```
BOT_ENGINE_ENABLED=true
```

### BOT_ENGINE_LOG_LEVEL
Control logging verbosity (default: "error")
- `debug`: All logs
- `info`: Info, warn, error
- `warn`: Warn and error only
- `error`: Error only

```
BOT_ENGINE_LOG_LEVEL=error
```

### BOT_MAX_ACTIONS_PER_TICK
Maximum actions to process per cron execution (default: 50)

```
BOT_MAX_ACTIONS_PER_TICK=50
```

### BOT_TICK_RATE_LIMIT_MS
Minimum milliseconds between tick executions (default: 50000)

```
BOT_TICK_RATE_LIMIT_MS=50000
```

---

## Vercel Cron Configuration

The `vercel.json` file defines the cron schedules:

| Endpoint | Schedule | Purpose |
|----------|----------|---------|
| `/api/cron/bot-tick` | `* * * * *` | Every minute |
| `/api/cron/bot-online` | `*/15 * * * *` | Every 15 minutes |
| `/api/cron/bot-match` | `0 * * * *` | Every hour |
| `/api/cron/bot-chat` | `*/5 * * * *` | Every 5 minutes |

---

## Testing Cron Endpoints

### Local Testing (with ngrok)
```bash
# 1. Start local server
npm run dev

# 2. Create tunnel (in another terminal)
ngrok http 3000

# 3. Test endpoint
curl -H "Authorization: Bearer your_secret" https://your-ngrok-url/api/cron/bot-tick
```

### Vercel Preview Testing
```bash
# Deploy preview
vercel --prod

# Test via Vercel dashboard or curl
curl -H "Authorization: Bearer your_secret" https://your-project.vercel.app/api/cron/bot-tick
```

---

## Monitoring

### Health Check Endpoint
```bash
curl https://your-project.vercel.app/api/cron/status
```

Returns:
- Bot count and active status
- Activity metrics (events, messages, chats)
- Pending matches count
- List of configured cron endpoints

### Vercel Cron Logs
View cron execution logs in Vercel Dashboard:
```
Project → Deployments → Select Deployment → Functions → Cron Jobs
```
