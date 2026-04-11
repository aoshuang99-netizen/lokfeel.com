#!/bin/bash
# Setup Resend Email for LokFeel
# Usage: ./scripts/setup-resend.sh <resend-api-key>

set -e

API_KEY=$1

if [ -z "$API_KEY" ]; then
    echo "❌ Error: Please provide your Resend API key"
    echo "Usage: ./scripts/setup-resend.sh re_xxxxxxxx"
    exit 1
fi

echo "🔧 Setting up Resend email for LokFeel..."

# Check if vercel CLI is available
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

echo "📦 Adding environment variables to Vercel..."

# Add environment variables
cd "$(dirname "$0")/.."

vercel env add SMTP_HOST production <<< "smtp.resend.com"
vercel env add SMTP_PORT production <<< "465"
vercel env add SMTP_USER production <<< "resend"
vercel env add SMTP_PASSWORD production <<< "$API_KEY"
vercel env add SMTP_FROM production <<< "hello@lokfeel.com"

echo "✅ Environment variables added successfully!"
echo ""
echo "🚀 Deploying to production..."
vercel --prod --yes

echo ""
echo "✅ Setup complete! Email service is now active."
echo ""
echo "📝 Test the email service:"
echo "   1. Visit https://app.lokfeel.com/register"
echo "   2. Register with your email"
echo "   3. Check your inbox for the verification code"
