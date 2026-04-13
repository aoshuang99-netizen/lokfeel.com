#!/bin/bash
# Bot Engine Deployment Setup Script
# Usage: ./scripts/setup-bot-engine.sh [production|preview]

set -e

ENVIRONMENT=${1:-production}

echo "=========================================="
echo "LokFeel Bot Engine - Deployment Setup"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "Error: Vercel CLI is not installed."
    echo "Install with: npm i -g vercel"
    exit 1
fi

# Generate a random secret key
CRON_SECRET=$(openssl rand -base64 32)
echo "Generated CRON_SECRET"

# Set environment variable
echo ""
echo "Setting CRON_SECRET environment variable..."
echo ""

if [ "$ENVIRONMENT" = "production" ]; then
    vercel env add CRON_SECRET production --yes <<< "$CRON_SECRET"
else
    vercel env add CRON_SECRET preview --yes <<< "$CRON_SECRET"
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Deploy the updated vercel.json with cron jobs:"
echo "   vercel --prod"
echo ""
echo "2. Verify the deployment:"
echo "   curl https://app.lokfeel.com/api/cron/status"
echo ""
echo "3. Check cron execution logs in Vercel Dashboard:"
echo "   Project → Deployments → Functions → Cron Jobs"
echo ""
