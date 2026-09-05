#!/usr/bin/env bash
# =============================================================================
# LokFeel — Git history purge for the leaked Turso auth token
# =============================================================================
# A REAL, read-write Turso JWT was committed to:
#   deploy-tasks/VERCEL_ENV_TEMPLATE.md
# (now redacted in the working tree, but still present in git HISTORY).
#
# This script rewrites history to replace that token literal with a placeholder.
# It MUST be run BEFORE the first `git push` of these commits, and the push
# must be a FORCE push (history is rewritten).
#
# ⚠️  DESTRUCTIVE: rewrites ALL commit hashes. Coordinate with anyone who has
#     cloned the repo. Run from a clean checkout with no uncommitted changes.
#
# Requires: git-filter-repo  (pip install git-filter-repo  OR  brew install git-filter-repo)
#
# Usage:
#   ./scripts/purge-turso-token.sh            # dry-run (shows what would change)
#   ./scripts/purge-turso-token.sh --execute  # actually rewrite history
# =============================================================================
set -euo pipefail

# Match the Turso JWT WITHOUT hardcoding the full secret literal:
#   header  = eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9
#   payload = <base64url>
#   sig     = <base64url>
# Replace with a non-secret placeholder.
TOKEN_RULE='regex:eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9[A-Za-z0-9_-]{10,}[A-Za-z0-9_-]{10,}==>REDACTED_TURSO_TOKEN'

if [ "${1:-}" != "--execute" ]; then
  echo "🔍 DRY RUN — no files will be changed."
  echo "    Run with --execute to actually rewrite history."
  echo "    Rule: $TOKEN_RULE"
  git filter-repo --dry-run --replace-text <(printf '%s\n' "$TOKEN_RULE")
  exit 0
fi

echo "⚠️  EXECUTING history rewrite. This changes all commit hashes."
echo "    After this, you MUST: git push --force origin main"
read -r -p "Type 'YES' to continue: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "Aborted."; exit 1
fi

git filter-repo --force --replace-text <(printf '%s\n' "$TOKEN_RULE")

echo "✅ Done. Verify no token remains:"
echo "   git log --all -p -S 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9' | head"
echo "Then force-push: git push --force origin main"
echo "And rotate the token in the Turso dashboard (old one is still valid until rotated)."
