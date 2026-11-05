#!/usr/bin/env node
/**
 * patch-opennext-build.mjs
 *
 * Workaround for a Next.js 16 (Turbopack) + OpenNext (@opennextjs/aws /
 * @opennextjs/cloudflare) build incompatibility in copyTracedFiles.js.
 *
 * Root cause:
 *   Next 16's Turbopack `standalone` output omits `server/instrumentation.js`
 *   and `server/middleware.js` from the standalone dir, but OpenNext's
 *   `copyTracedFiles` -> `computeCopyFilesForPage()` asserts those files exist
 *   there (after copying only their .nft.json) and throws otherwise:
 *     Error: This error should only happen for static 404 and 500 page from page
 *            router. Report this if that's not the case.,
 *            File server/<instrumentation|middleware>.js does not exist
 *
 * Fix (mirroring what OpenNext already does upstream for instrumentation in some
 * versions): copy the real `server/*.js` from the Next build dir into the
 * standalone dir when it is missing.
 *
 * Idempotent and safe to run on every `cf:build` (local + CI). Behaviour:
 *   - Skips silently if a fix is already present (detected by a unique marker).
 *   - Skips (non-fatal) if the target file is absent (e.g. OpenNext removed),
 *     so the real build error still surfaces.
 *   - Fails loudly (exit 1) if the expected anchor moved, so a future OpenNext
 *     change is caught instead of silently shipping a broken bundle.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const target = resolve(
  repoRoot,
  "node_modules",
  "@opennextjs",
  "aws",
  "dist",
  "build",
  "copyTracedFiles.js"
);

if (!existsSync(target)) {
  console.warn(
    `[patch-opennext] SKIP: ${target} not found. Is @opennextjs/aws installed? ` +
      `If OpenNext was upgraded, this workaround may be obsolete.`
  );
  process.exit(0);
}

let content = readFileSync(target, "utf8");
let patched = false;

/**
 * Ensure a "copy <file> from build dir into standalone dir if missing" block
 * exists right before `computeCopyFilesForPage("<name>");`.
 */
function ensureCopyFix({ name, marker, anchor, varName }) {
  if (content.includes(marker)) return; // already applied (our marker)
  if (!content.includes(anchor)) {
    console.error(
      `[patch-opennext] FATAL: anchor ${JSON.stringify(
        anchor
      )} not found in ${target}. OpenNext changed upstream — inspect manually.`
    );
    process.exit(1);
  }
  // If upstream already declares this variable, assume its own fix is present.
  if (content.includes(`const ${varName} =`)) {
    console.log(
      `[patch-opennext] ${name}: ${varName} already declared; assuming upstream fix present.`
    );
    return;
  }
  const insert = `        // Next 16's standalone output (Turbopack) no longer includes \`server/${name}.js\`
        // in the standalone dir, but \`computeCopyFilesForPage("${name}")\` asserts it
        // exists there. Copy it from the build dir (mirroring the .nft.json copy above)
        // so the assertion passes and the ${name} file ships in the bundle.
        const ${varName} = path.join("server", "${name}.js");
        if (existsSync(path.join(dotNextDir, ${varName})) &&
            !existsSync(path.join(standaloneNextDir, ${varName}))) {
            copyFileAndMakeOwnerWritable(path.join(dotNextDir, ${varName}), path.join(standaloneNextDir, ${varName}));
        }
        `;
  content = content.replace(anchor, insert + anchor);
  patched = true;
  console.log(`[patch-opennext] queued fix for server/${name}.js`);
}

ensureCopyFix({
  name: "instrumentation",
  marker: "Next 16's standalone output no longer includes `server/instrumentation.js`",
  anchor: 'computeCopyFilesForPage("instrumentation");',
  varName: "instrumentationServerFile",
});

ensureCopyFix({
  name: "middleware",
  marker: "Next 16's standalone output (Turbopack) no longer includes `server/middleware.js`",
  anchor: 'computeCopyFilesForPage("middleware");',
  varName: "middlewareServerFile",
});

if (patched) {
  writeFileSync(target, content, "utf8");
  console.log("[patch-opennext] Applied OpenNext copyTracedFiles.js fixes.");
} else {
  console.log("[patch-opennext] All fixes already present. Skipping.");
}
process.exit(0);
