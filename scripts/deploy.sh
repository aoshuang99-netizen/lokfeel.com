#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# Nexus App — One-Shot Deploy Script
# Usage: bash scripts/deploy.sh
# ════════════════════════════════════════════════════════════════
set -e

export PATH="$HOME/.npm-global/bin:$PATH"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
CYAN="\033[0;36m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗"
echo "  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝"
echo "  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗"
echo "  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║"
echo "  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║"
echo "  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝"
echo -e "${RESET}"
echo -e "${BOLD}  Nexus App — Production Deploy Script${RESET}"
echo -e "  ─────────────────────────────────────────"
echo ""

# ── Step 1: Check prerequisites ──────────────────────────────
echo -e "${BOLD}[1/7] Checking prerequisites...${RESET}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found. Install from https://nodejs.org${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${RESET}"

if ! command -v vercel &>/dev/null; then
  echo -e "${YELLOW}⚡ Installing Vercel CLI...${RESET}"
  npm install -g vercel
fi
echo -e "${GREEN}✓ Vercel CLI $(vercel --version 2>/dev/null | head -1)${RESET}"

# ── Step 2: Check Vercel login ────────────────────────────────
echo ""
echo -e "${BOLD}[2/7] Checking Vercel authentication...${RESET}"
if ! vercel whoami &>/dev/null; then
  echo -e "${YELLOW}⚡ Please log in to Vercel:${RESET}"
  vercel login
fi
VERCEL_USER=$(vercel whoami 2>/dev/null)
echo -e "${GREEN}✓ Logged in as: ${VERCEL_USER}${RESET}"

# ── Step 3: Check DATABASE_URL ────────────────────────────────
echo ""
echo -e "${BOLD}[3/7] Checking database configuration...${RESET}"

if [ -f ".env.local" ]; then
  source .env.local 2>/dev/null || true
fi

if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == *"mysql://"* ]]; then
  echo -e "${YELLOW}⚠ DATABASE_URL not set or still MySQL.${RESET}"
  echo ""
  echo -e "  Please create a FREE PostgreSQL database at:"
  echo -e "  ${CYAN}https://neon.tech${RESET} (recommended)"
  echo -e "  ${CYAN}https://supabase.com${RESET} (alternative)"
  echo ""
  echo -e "  Then add to .env.local:"
  echo -e "  ${CYAN}DATABASE_URL=\"postgresql://user:pass@host/nexus?sslmode=require\"${RESET}"
  echo ""
  read -p "  Press ENTER when DATABASE_URL is set in .env.local, or Ctrl+C to abort: " _
  source .env.local 2>/dev/null || true
fi

if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == *"mysql://"* ]]; then
  echo -e "${RED}✗ PostgreSQL DATABASE_URL still not configured. Aborting.${RESET}"
  exit 1
fi
echo -e "${GREEN}✓ DATABASE_URL configured (PostgreSQL)${RESET}"

# ── Step 4: Generate Prisma client & push schema ──────────────
echo ""
echo -e "${BOLD}[4/7] Setting up database schema...${RESET}"
echo -e "${CYAN}  Running: prisma generate${RESET}"
npx prisma generate

echo -e "${CYAN}  Running: prisma db push${RESET}"
npx prisma db push --force-reset 2>/dev/null || npx prisma db push
echo -e "${GREEN}✓ Database schema pushed${RESET}"

# ── Step 5: Build ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/7] Building application...${RESET}"
npm run build
echo -e "${GREEN}✓ Build successful${RESET}"

# ── Step 6: Set Vercel env vars ───────────────────────────────
echo ""
echo -e "${BOLD}[6/7] Configuring Vercel environment variables...${RESET}"

# Generate AUTH_SECRET if not set
if [ -f ".env.local" ]; then
  AUTH_SECRET_VAL=$(grep "^AUTH_SECRET=" .env.local | cut -d'=' -f2- | tr -d '"')
fi
if [ -z "$AUTH_SECRET_VAL" ]; then
  AUTH_SECRET_VAL=$(openssl rand -base64 32)
fi

# Read values
DATABASE_URL_VAL=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d'=' -f2- | tr -d '"')
APP_URL="https://nexus-app.vercel.app"

echo -e "${CYAN}  Setting DATABASE_URL...${RESET}"
echo "$DATABASE_URL_VAL" | vercel env add DATABASE_URL production --yes 2>/dev/null || \
  echo "$DATABASE_URL_VAL" | vercel env add DATABASE_URL production 2>/dev/null || true

echo -e "${CYAN}  Setting AUTH_SECRET...${RESET}"
echo "$AUTH_SECRET_VAL" | vercel env add AUTH_SECRET production --yes 2>/dev/null || true

echo -e "${CYAN}  Setting NEXTAUTH_URL...${RESET}"
echo "$APP_URL" | vercel env add NEXTAUTH_URL production --yes 2>/dev/null || true
echo "$APP_URL" | vercel env add AUTH_URL production --yes 2>/dev/null || true
echo "$APP_URL" | vercel env add NEXT_PUBLIC_APP_URL production --yes 2>/dev/null || true
echo "Nexus" | vercel env add NEXT_PUBLIC_APP_NAME production --yes 2>/dev/null || true

# Optional: Stripe keys from .env.local
for KEY in STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PREMIUM_MONTHLY_PRICE_ID STRIPE_PREMIUM_YEARLY_PRICE_ID STRIPE_LIFETIME_PRICE_ID GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  VAL=$(grep "^${KEY}=" .env.local 2>/dev/null | cut -d'=' -f2- | tr -d '"')
  if [ -n "$VAL" ]; then
    echo "$VAL" | vercel env add "$KEY" production --yes 2>/dev/null || true
    echo -e "${GREEN}  ✓ ${KEY}${RESET}"
  fi
done

echo -e "${GREEN}✓ Environment variables configured${RESET}"

# ── Step 7: Deploy ────────────────────────────────────────────
echo ""
echo -e "${BOLD}[7/7] Deploying to Vercel...${RESET}"
DEPLOY_OUTPUT=$(vercel --prod --yes 2>&1)
echo "$DEPLOY_OUTPUT"

DEPLOY_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | tail -1)

echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${RESET}"
echo -e "${BOLD}${GREEN}  ✅ Nexus App DEPLOYED SUCCESSFULLY!${RESET}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${RESET}"
echo ""
if [ -n "$DEPLOY_URL" ]; then
  echo -e "  🌐 URL: ${CYAN}${DEPLOY_URL}${RESET}"
fi
echo -e "  🔑 Dashboard: ${CYAN}https://vercel.com/dashboard${RESET}"
echo ""
echo -e "${BOLD}  Next Steps:${RESET}"
echo -e "  1. Visit ${CYAN}${DEPLOY_URL}/api/health${RESET} to verify"
echo -e "  2. Set up Stripe webhook: ${CYAN}${DEPLOY_URL}/api/webhooks/stripe${RESET}"
echo -e "  3. Configure Google OAuth callback URL:"
echo -e "     ${CYAN}${DEPLOY_URL}/api/auth/callback/google${RESET}"
echo ""
