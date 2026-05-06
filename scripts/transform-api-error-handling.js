/**
 * Script to transform API route files to use handleApiError wrapper.
 * This handles multiple patterns found across the codebase.
 */
const fs = require('fs');
const path = require('path');

const files = [
  'src/app/api/chat/[id]/messages/route.ts',
  'src/app/api/chat/[id]/route.ts',
  'src/app/api/chat/[id]/vault/route.ts',
  'src/app/api/im/consent/route.ts',
  'src/app/api/im/presence/route.ts',
  'src/app/api/im/pusher/auth/route.ts',
  'src/app/api/im/typing/route.ts',
  'src/app/api/matches/[id]/pitch/generate/route.ts',
  'src/app/api/matches/[id]/pitch/route.ts',
  'src/app/api/matches/[id]/route.ts',
  'src/app/api/matches/inbox/route.ts',
  'src/app/api/matches/route.ts',
  'src/app/api/matches/weekly/route.ts',
  'src/app/api/matching/enhanced/route.ts',
  'src/app/api/matching/generate/route.ts',
  'src/app/api/notifications/route.ts',
  'src/app/api/notifications/unread-count/route.ts',
  'src/app/api/payments/checkout/route.ts',
  'src/app/api/payments/confirm-verification/route.ts',
  'src/app/api/payments/pingpong/checkout/route.ts',
  'src/app/api/payments/portal/route.ts',
  'src/app/api/payments/status/route.ts',
  'src/app/api/payments/verify-card/route.ts',
  'src/app/api/profile/[userId]/route.ts',
  'src/app/api/profile/route.ts',
  'src/app/api/rules/[userId]/route.ts',
  'src/app/api/rules/check/route.ts',
  'src/app/api/rules/history/route.ts',
  'src/app/api/rules/route.ts',
  'src/app/api/rules/validate/route.ts',
  'src/app/api/sincerity/earn/route.ts',
  'src/app/api/sincerity/wallet/route.ts',
  'src/app/api/upload/route.ts',
  'src/app/api/user/limits/route.ts',
];

const ROOT = '/Users/frankzhao/WorkBuddy/20260402202519/nexus-app';

function transformFile(filePath) {
  const fullPath = path.join(ROOT, filePath);
  let content = fs.readFileSync(fullPath, 'utf-8');
  
  // Skip if already using handleApiError
  if (content.includes("handleApiError")) {
    console.log(`SKIP (already has handleApiError): ${filePath}`);
    return;
  }

  // Step 1: Add handleApiError import
  if (content.includes("from '@/lib/auth/auth'")) {
    content = content.replace(
      "from '@/lib/auth/auth'",
      "from '@/lib/auth/auth'\nimport { handleApiError } from '@/lib/api-handler'"
    );
  } else if (content.includes("from '@/lib/auth'")) {
    content = content.replace(
      "from '@/lib/auth'",
      "from '@/lib/auth'\nimport { handleApiError } from '@/lib/api-handler'"
    );
  } else {
    console.log(`WARN (no auth import found): ${filePath}`);
  }

  // Step 2: Remove the manual "Unauthorized" check in catch blocks
  // Pattern: if (error.message === 'Unauthorized') { return ... status: 401 }
  content = content.replace(
    /}\s*catch\s*\(\s*error\s*(?::\s*any)?\s*\)\s*\{\s*\n\s*if\s*\(\s*error\.message\s*===\s*['"]Unauthorized['"]\s*\)\s*\{\s*\n\s*return\s+NextResponse\.json\([^)]+\)\s*;\s*\n\s*\}\s*\n\s*/g,
    '} catch (error) {\n    console.error'
  );

  // Also handle "Unauthorized" || "User not found" pattern  
  content = content.replace(
    /}\s*catch\s*\(\s*error\s*(?::\s*any)?\s*\)\s*\{\s*\n\s*if\s*\(\s*error\?\.message\s*===\s*['"]Unauthorized['"]\s*\|\|\s*error\?\.message\s*===\s*['"]User not found['"]\s*\)\s*\{\s*\n\s*return\s+NextResponse\.json\([^)]+\)\s*;\s*\n\s*\}\s*\n\s*/g,
    '} catch (error) {\n    console.error'
  );

  // Step 3: Remove "Forbidden: Admin access required" manual checks
  content = content.replace(
    /\s*if\s*\(\s*error\.message\s*===\s*['"]Forbidden:\s*Admin\s*access\s*required['"]\s*\)\s*\{\s*\n\s*return\s+NextResponse\.json\([^)]+\)\s*;\s*\n\s*\}\s*\n?/g,
    ''
  );

  // Step 4: Replace the generic status: 500 in catch blocks that now handle auth via handleApiError
  // For files that already have the Unauthorized check removed, the catch block should just have:
  // console.error + return 500 -> this stays as-is since handleApiError will catch before it

  fs.writeFileSync(fullPath, content);
  console.log(`DONE: ${filePath}`);
}

files.forEach(transformFile);
