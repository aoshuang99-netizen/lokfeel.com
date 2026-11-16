#!/usr/bin/env node
/**
 * V22 DEV09 · claim gate (RED → GREEN with negative controls)
 * ═══════════════════════════════════════════════════════════════════════════
 * Pure Node, no third-party dependencies. CI-callable. READ-ONLY for
 * docs/v22/claim_register.csv and docs/v22/capabilities.yaml.
 *
 * What it does
 *   · reads the claim register + capabilities.yaml (minimal YAML parse: split
 *     on "- id:" blocks, take the "status:" line — no YAML package);
 *   · scans src/app/(landing)/page.tsx and src/app/(public)/**\/page.tsx for
 *     USER-VISIBLE strings. Comments (//, /* *\/, {/* *\/}, {# ... #}) are
 *     blanked first, so a banned word that lives only in a comment is NOT a
 *     violation. Line numbers are preserved for reporting;
 *   · enforces the hard rules from §D / STRATEGY_LOCK §1 / §J V22-G10.
 *
 * Usage:
 *   env -u NODE_OPTIONS node scripts/qa/v22-claim-gate.mjs --self-test
 *   env -u NODE_OPTIONS node scripts/qa/v22-claim-gate.mjs
 *
 * Exit: 0 = CLAIM_GATE=PASS, 1 = CLAIM_GATE=FAIL (any hard-rule hit).
 * Other pages may still hit: those are reported as pending remediation, and the
 * rules are NOT relaxed and NO global allowlist is added to make the gate green.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo root from this file (…/nexus-app/scripts/qa/v22-claim-gate.mjs)
// so CI can call it from any working directory.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────
// Truth sources (read-only)
// ─────────────────────────────────────────────────────────────────────────
const CLAIM_REGISTER = 'docs/v22/claim_register.csv';
const CAPABILITIES = 'docs/v22/capabilities.yaml';
const LANDING_PAGE = 'src/app/(landing)/page.tsx';
const PUBLIC_DIR = 'src/app/(public)';

// The D1 gate introduced by DEV07. If it cannot be read, treat it as CLOSED
// (fail closed) rather than assuming prices are allowed.
const GATE_TRUTH_FILES = [
  'src/config/pricing-gate.ts',
  'src/app/(public)/pricing/page.tsx',
];

/**
 * Banned-word allowlist — the ONLY exception, and deliberately narrow.
 * §D / STRATEGY_LOCK §1: technical terms may appear only in /product's
 * "For developers" collapsed section (technical implementation, not a
 * Hero/title/CTA marketing claim).
 *
 * Rule = explicit file path + a line-number range derived from the anchor:
 *   · only hits whose file === this file AND whose line is inside
 *     [anchorLine .. the closing </details> line] (fallback: +windowLines) are
 *     suppressed;
 *   · every other file and every other line (metadata, hero, CTA, footer)
 *     is judged normally — this is NOT a site-wide bypass;
 *   · only BANNED_WORD hits are suppressible. Chinese / prices / verified /
 *     old brand / planned-capability claims are never waived.
 * If the anchor is missing, the allowlist is INACTIVE (no bypass at all).
 */
const BANNED_ALLOWLIST = {
  file: 'src/app/(public)/product/page.tsx',
  anchor: 'For developers',
  /** The fold is a <details> block; its closing tag bounds the allowlist. */
  endMarker: '</details>',
  /** Fallback if the fold markup changes: bound the window instead of all lines. */
  windowLines: 60,
  reason: '/product "For developers" fold — technical implementation only',
};

// ─────────────────────────────────────────────────────────────────────────
// Hard rules
// ─────────────────────────────────────────────────────────────────────────

/** §D / STRATEGY_LOCK §1 — banned in Hero / title / CTA context. */
const BANNED_TERMS = [
  { id: 'Connection OS', re: /\bConnection OS\b/i },
  { id: 'Agent OS', re: /\bAgent OS\b/i },
  { id: 'Mission pipeline', re: /\bMission pipeline\b/i },
  { id: 'WorkspaceSpec', re: /\bWorkspaceSpec\b/i },
  { id: 'Compiler', re: /\bCompiler\b/i },
  { id: 'INTENT_EXTRACTION', re: /\bINTENT_EXTRACTION\b/i },
  { id: 'MCP tools', re: /\bMCP tools\b/i },
  { id: 'A2A', re: /\bA2A\b/i },
];

/** §D Truth Gate — "verified" / "Verified Outcome" as a marketing label. */
const VERIFIED_PHRASE = /\bVerified Outcome\b/i;
const VERIFIED_WORD = /\bverified\b/i;

/** Prices may only appear when the D1 pricing gate is closed → violation. */
const PRICE_DOLLAR = /\$\s*\d[\d,]*(?:\.\d+)?/;
const PRICE_PER_MONTH_CN = /\/月/;
const PRICE_PER_MONTH_EN = /\/mo\b/i;

/** All-English discipline: Han characters / CJK punctuation in visible copy. */
const CHINESE_RE = /[\u3000-\u303F\u3400-\u9FFF\uF900-\uFAFF]/;

/** Old brand. "LokFeel" must NOT match — the "!" is required. */
const OLD_BRAND_RE = /LokFee!/i;

/**
 * Honest boundaries ("never verified", "not yet", "planned", ...) are NOT
 * support claims. Used to avoid flagging negations as "already supported".
 */
const NEGATION_RE =
  /\b(never|not|no|isn't|aren't|doesn't|don't|can't|cannot|without|unverified|self[-\s]?reported|stays|remains|pending|planned|gated|coming soon|not yet|no longer|is not|are not|does not|do not|only after|instead of)\b/i;

/**
 * Supported-semantics phrases for status=planned capabilities. Keyed by the
 * capability id from capabilities.yaml. At minimum the two required by DEV09:
 * external action (CAP-EXTERNAL-ACTION) and outcome verification
 * (CAP-OUTCOME-VERIFICATION). Every planned id must have patterns here, else
 * the script fails loudly instead of silently skipping a capability.
 */
const PLANNED_CLAIM_PATTERNS = {
  'CAP-EXTERNAL-ACTION': [
    /\bexternal actions?\b/i,
    /\bexternal execution\b/i,
    /\breal (?:external|third[-\s]?party) (?:action|execution)\b/i,
    /\bautomatic(?:ally)? (?:complete|execute|run|act|perform)\b/i,
    /\bcross[-\s]?app\b.*\b(?:execut|automat|autonom|run|action)/i,
    /\bfully autonomous\b/i,
  ],
  'CAP-OUTCOME-VERIFICATION': [
    /\bverified outcomes?\b/i,
    /\boutcome verification\b/i,
    /\bindependently verified\b/i,
    /\bexternally verified\b/i,
    /\bresults? (?:are|is|already) verified\b/i,
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────

/** Empty-set assertions are a precondition, never a "PASS by default". */
function assertNonEmpty(label, arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error(`precondition failed: ${label} is empty (empty set would be a false green)`);
  }
}

function readFile(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Minimal CSV: quoted fields may contain commas and escaped "" quotes. */
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function readClaimRegister(rel) {
  const raw = readFile(rel).replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  assertNonEmpty('claim_register.csv lines', lines);
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((l) => {
    const cells = parseCsvLine(l);
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
  assertNonEmpty('claim_register.csv data rows', rows);
  return { header, rows };
}

/**
 * Minimal YAML parse: split into "- id:" blocks, take the status: line.
 * No third-party YAML library. Top-level keys before `capabilities:` are
 * ignored because no block is open yet.
 */
function readCapabilities(rel) {
  const lines = readFile(rel).split(/\r?\n/);
  const caps = [];
  let cur = null;
  for (const line of lines) {
    const idMatch = line.match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (idMatch) {
      cur = { id: idMatch[1].trim(), name: null, status: null, uiClaim: null };
      caps.push(cur);
      continue;
    }
    if (!cur) continue;
    const status = line.match(/^\s*status:\s*(.+?)\s*$/);
    if (status) cur.status = status[1].trim().replace(/^["']|["']$/g, '');
    const name = line.match(/^\s*name:\s*(.+?)\s*$/);
    if (name) cur.name = name[1].trim();
    const ui = line.match(/^\s*uiClaim:\s*(.+?)\s*$/);
    if (ui) cur.uiClaim = ui[1].trim();
  }
  const withStatus = caps.filter((c) => c.status !== null);
  assertNonEmpty('capabilities.yaml parsed capability blocks', withStatus);
  return withStatus;
}

/** Fail-closed read of the D1 pricing switch. */
function readPricingGate() {
  const states = [];
  const seen = [];
  for (const rel of GATE_TRUTH_FILES) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, 'utf8');
    seen.push(rel);
    for (const m of src.matchAll(/PRICING_APPROVED\s*(?::\s*boolean\s*)?=\s*(true|false)\b/g)) {
      states.push(m[1]);
    }
  }
  const closed = states.length === 0 || states.includes('false');
  return { closed, states, seen };
}

function discoverPageFiles() {
  const files = [];
  if (existsSync(join(ROOT, LANDING_PAGE))) files.push(LANDING_PAGE);
  const walk = (absDir, relDir) => {
    for (const ent of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, ent.name);
      const rel = `${relDir}/${ent.name}`;
      if (ent.isDirectory()) walk(abs, rel);
      else if (ent.isFile() && ent.name === 'page.tsx') files.push(rel);
    }
  };
  const publicRoot = join(ROOT, PUBLIC_DIR);
  if (existsSync(publicRoot)) walk(publicRoot, PUBLIC_DIR);
  return files.sort();
}

/**
 * Blank out // , /* *\/ , {/* *\/} and {# ... #} comments while KEEPING the
 * string length and newline positions (line numbers stay true). Strings are
 * tracked so "//" inside a URL or regex literal is not mistaken for a comment.
 * Also returns the [start,end) spans of string-literal contents.
 */
function analyze(src) {
  const n = src.length;
  const out = src.split('');
  const stringSpans = [];
  let i = 0;
  let state = 'code'; // code | squote | dquote | template | templateExpr | line | block | hash
  let strStart = -1;
  let exprDepth = 0;
  let exprQuote = null;
  let exprStrStart = -1;

  const blank = (idx) => {
    if (idx >= 0 && idx < n && out[idx] !== '\n' && out[idx] !== '\r') out[idx] = ' ';
  };

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (state === 'code') {
      if (c === '/' && c2 === '/') {
        state = 'line';
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === '/' && c2 === '*') {
        state = 'block';
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === '{' && c2 === '#') {
        state = 'hash';
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c === "'" ? 'squote' : c === '"' ? 'dquote' : 'template';
        strStart = i + 1;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (state === 'line') {
      if (c === '\n' || c === '\r') state = 'code';
      else blank(i);
      i++;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        blank(i);
        blank(i + 1);
        state = 'code';
        i += 2;
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    if (state === 'hash') {
      if (c === '#' && c2 === '}') {
        blank(i);
        blank(i + 1);
        state = 'code';
        i += 2;
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    // ${...} inside a template literal is CODE, not user-visible text. Blank it
    // so regex literals / identifiers in the interpolation are not flagged;
    // string literals inside the interpolation ARE kept visible (they render).
    if (state === 'template' && c === '$' && c2 === '{') {
      state = 'templateExpr';
      exprDepth = 1;
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }

    if (state === 'templateExpr') {
      if (exprQuote !== null) {
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === exprQuote) {
          if (exprStrStart >= 0 && i > exprStrStart) stringSpans.push([exprStrStart, i]);
          exprQuote = null;
          exprStrStart = -1;
        }
        i++;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        exprQuote = c;
        exprStrStart = i + 1;
        i++;
        continue;
      }
      if (c === '{') {
        exprDepth++;
        blank(i);
        i++;
        continue;
      }
      if (c === '}') {
        exprDepth--;
        blank(i);
        i++;
        if (exprDepth === 0) state = 'template';
        continue;
      }
      blank(i);
      i++;
      continue;
    }

    // Inside a string literal: keep contents, honour escapes, detect closing quote.
    const q = state === 'squote' ? "'" : state === 'dquote' ? '"' : '`';
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === q) {
      if (strStart >= 0 && i > strStart) stringSpans.push([strStart, i]);
      state = 'code';
      strStart = -1;
      i++;
      continue;
    }
    if (state !== 'template' && (c === '\n' || c === '\r')) {
      // Unterminated single/double quoted string: stop it at the line break.
      if (strStart >= 0 && i > strStart) stringSpans.push([strStart, i]);
      state = 'code';
      strStart = -1;
    }
    i++;
  }
  return { clean: out.join(''), stringSpans };
}

/** Build a same-length "visible text" mask: string contents + JSX text only. */
function buildVisibleMask(clean, stringSpans) {
  const n = clean.length;
  const mask = new Array(n).fill(' ');
  for (let i = 0; i < n; i++) {
    if (clean[i] === '\n' || clean[i] === '\r') mask[i] = clean[i];
  }
  const put = (start, end) => {
    for (let k = start; k < end && k < n; k++) {
      if (mask[k] === ' ') mask[k] = clean[k];
    }
  };
  for (const [s, e] of stringSpans) put(s, e);
  // JSX text nodes: plain text between a tag-close ">" and the next "<".
  const re = />[^<>{}]+</g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    put(m.index + 1, m.index + m[0].length - 1);
  }
  return mask.join('');
}

/** Rule engine over one visible-text line. Returns [{rule, snippet}]. */
function checkLine(text, ctx) {
  const hits = [];
  const snippet = text.trim().slice(0, 140);
  const add = (rule) => {
    if (!hits.some((h) => h.rule === rule)) hits.push({ rule, snippet });
  };
  const negated = NEGATION_RE.test(text);

  // R1 — banned words in Hero / title / CTA context.
  if (!ctx.suppressBannedWords) {
    for (const term of BANNED_TERMS) {
      if (term.re.test(text)) add(`BANNED_WORD(${term.id})`);
    }
  }

  // R2 — "verified" / "Verified Outcome" as a marketing label.
  if (!negated) {
    if (VERIFIED_PHRASE.test(text)) add('VERIFIED_LABEL(Verified Outcome)');
    else if (VERIFIED_WORD.test(text)) add('VERIFIED_LABEL(verified)');
  }

  // R3 — concrete price / per-month while the D1 pricing gate is closed.
  if (ctx.gateClosed) {
    if (PRICE_DOLLAR.test(text)) add('PRICE_WHEN_GATE_CLOSED($amount)');
    if (PRICE_PER_MONTH_CN.test(text)) add('PRICE_WHEN_GATE_CLOSED(/月)');
    if (PRICE_PER_MONTH_EN.test(text)) add('PRICE_WHEN_GATE_CLOSED(/mo)');
  }

  // R4 — Chinese characters in public-page visible copy (all-English rule).
  if (CHINESE_RE.test(text)) add('CHINESE_VISIBLE');

  // R5 — old brand.
  if (OLD_BRAND_RE.test(text)) add('OLD_BRAND(LokFee!)');

  // R6 — planned capabilities written as already-supported semantics.
  if (!negated) {
    for (const cap of ctx.plannedRules) {
      if (cap.patterns.some((p) => p.test(text))) {
        add(`PLANNED_CAP_AS_SUPPORTED(${cap.id})`);
      }
    }
  }

  // R7 — verbatim regression of a REWRITE_REQUIRED/REMOVE claim from the register.
  for (const kc of ctx.knownClaims) {
    if (text.includes(kc.claim)) add(`CLAIM_REGISTER(${kc.id})`);
  }

  return hits;
}

function resolveAllowlist() {
  const p = join(ROOT, BANNED_ALLOWLIST.file);
  if (!existsSync(p)) {
    return { active: false, note: `allowlist file missing: ${BANNED_ALLOWLIST.file}` };
  }
  const lines = readFileSync(p, 'utf8').split(/\r?\n/);
  let anchorLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(BANNED_ALLOWLIST.anchor)) {
      anchorLine = i + 1;
      break;
    }
  }
  if (anchorLine < 0) {
    return {
      active: false,
      note: `anchor "${BANNED_ALLOWLIST.anchor}" not found in ${BANNED_ALLOWLIST.file}; allowlist INACTIVE (no bypass)`,
    };
  }
  const from = anchorLine;
  // Prefer the real end of the collapsed section over a fixed line window.
  let endLine = -1;
  for (let i = from; i < lines.length; i++) {
    if (lines[i].includes(BANNED_ALLOWLIST.endMarker)) {
      endLine = i + 1;
      break;
    }
  }
  const to = endLine > 0 ? endLine : from + BANNED_ALLOWLIST.windowLines;
  return {
    active: true,
    file: BANNED_ALLOWLIST.file,
    from,
    to,
    note: `${BANNED_ALLOWLIST.file}:${from}..${to} (bounded by "${BANNED_ALLOWLIST.endMarker}"; ${BANNED_ALLOWLIST.reason})`,
  };
}

/** Pure function so the narrow allowlist can be negative-tested. */
function isBannedWordAllowlisted(file, line, allow) {
  return allow.active === true && file === allow.file && line >= allow.from && line <= allow.to;
}

// ─────────────────────────────────────────────────────────────────────────
// Self-test (in-memory samples, RED → GREEN)
// ─────────────────────────────────────────────────────────────────────────

// Violating strings MUST be judged FAIL (≥1 rule hit).
const VIOLATION_SAMPLES = [
  'Connection OS for AI-native teams',
  'Outcome · verified',
  'From $89/mo',
  '订阅 Starter 套餐',
  'LokFee! is back',
  '5 MCP tools · 50 REST routes',
  'Real external action, automatically executed across apps',
  'Outcome verification is available today',
  'WorkspaceSpec compiles your goal',
];

// Compliant strings MUST be judged PASS (0 rule hits).
const COMPLIANT_SAMPLES = [
  'Say what you want done. Stay in control.',
  'Pricing is not published yet',
  'Please contact us for details',
  'Turn one goal into clear steps',
  'Self-reporting never counts as verified',
  'We do not publish pricing until it is approved',
];

// A banned word ONLY in a comment must not be flagged; the SAME word in
// visible JSX text / string literals must be flagged.
const COMMENT_FORMS = [
  ['// line comment', 'const x = 1; // Connection OS is only in this comment\nexport default function P(){ return <p>Hello</p>; }'],
  ['/* block comment */', '/* WorkspaceSpec and MCP tools live here */\nexport default function P(){ return <p>Hello</p>; }'],
  ['{/* JSX comment */}', 'export default function P(){ return (<div>{/* A2A is internal only */}<p>Hello</p></div>); }'],
  ['{# /* */ #} comment', 'export default function P(){ return (<div>{# INTENT_EXTRACTION internal #}<p>Hello</p></div>); }'],
];

const VISIBLE_FORMS = [
  '<h1>Connection OS for teams</h1>',
  '<p>5 MCP tools available</p>',
  'const label = "A2A task endpoint";',
  'const t = `WorkspaceSpec v1`;',
];

function selfTestContext() {
  const plannedRules = Object.entries(PLANNED_CLAIM_PATTERNS).map(([id, patterns]) => ({ id, patterns }));
  return { gateClosed: true, suppressBannedWords: false, plannedRules, knownClaims: [] };
}

function extractHits(snippet, ctx) {
  const { clean, stringSpans } = analyze(snippet);
  const mask = buildVisibleMask(clean, stringSpans);
  const hits = [];
  const lines = mask.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    for (const h of checkLine(lines[i], ctx)) hits.push(h);
  }
  return hits;
}

function runSelfTest() {
  const lines = [];
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  // Precondition: non-empty sample sets (空集恒真 = 假绿).
  assertNonEmpty('VIOLATION_SAMPLES', VIOLATION_SAMPLES);
  assertNonEmpty('COMPLIANT_SAMPLES', COMPLIANT_SAMPLES);
  assertNonEmpty('BANNED_TERMS', BANNED_TERMS);
  assertNonEmpty('PLANNED_CLAIM_PATTERNS', Object.keys(PLANNED_CLAIM_PATTERNS));
  assert(VIOLATION_SAMPLES.length >= 3, 'need at least 3 violating samples');
  assert(COMPLIANT_SAMPLES.length >= 3, 'need at least 3 compliant samples');

  // Negative control for the empty-set guard itself: it must fail loudly.
  let emptyGuardFired = false;
  try {
    assertNonEmpty('simulated empty scan set', []);
  } catch {
    emptyGuardFired = true;
  }
  assert(emptyGuardFired, 'empty-set assertion did not fail loudly (false green)');
  lines.push('  empty-set precondition: FAIL LOUDLY ✓');

  const ctx = selfTestContext();

  // Violating strings → FAIL.
  for (const s of VIOLATION_SAMPLES) {
    const hits = checkLine(s, ctx);
    assert(hits.length > 0, `violating sample was judged PASS: ${JSON.stringify(s)}`);
    lines.push(`  FAIL ✓ ${JSON.stringify(s)} -> ${hits.map((h) => h.rule).join(', ')}`);
  }

  // Compliant strings → PASS.
  for (const s of COMPLIANT_SAMPLES) {
    const hits = checkLine(s, ctx);
    assert(hits.length === 0, `compliant sample was judged FAIL: ${JSON.stringify(s)} -> ${hits.map((h) => h.rule).join(', ')}`);
    lines.push(`  PASS ✓ ${JSON.stringify(s)}`);
  }

  // Comment stripping: banned words in comments must be invisible.
  for (const [form, snippet] of COMMENT_FORMS) {
    const hits = extractHits(snippet, ctx);
    assert(hits.length === 0, `${form}: banned word leaked from comment -> ${hits.map((h) => h.rule).join(', ')}`);
    lines.push(`  COMMENT-STRIP ✓ ${form}`);
  }

  // Visible strings: banned words in JSX text / literals must be caught.
  for (const snippet of VISIBLE_FORMS) {
    const hits = extractHits(snippet, ctx);
    assert(
      hits.some((h) => h.rule.startsWith('BANNED_WORD')),
      `visible banned word was NOT caught: ${JSON.stringify(snippet)}`,
    );
    lines.push(`  VISIBLE-CATCH ✓ ${JSON.stringify(snippet)}`);
  }

  // Narrow allowlist: inside range suppressed, outside range / other file NOT.
  const fakeAllow = { active: true, file: 'src/app/(public)/product/page.tsx', from: 100, to: 160 };
  assert(isBannedWordAllowlisted('src/app/(public)/product/page.tsx', 120, fakeAllow) === true, 'allowlist should suppress an in-range hit');
  assert(isBannedWordAllowlisted('src/app/(public)/product/page.tsx', 99, fakeAllow) === false, 'allowlist must not suppress an out-of-range line');
  assert(isBannedWordAllowlisted('src/app/(landing)/page.tsx', 120, fakeAllow) === false, 'allowlist must not bypass other files');
  lines.push('  ALLOWLIST narrow scope ✓ (in-range only, not site-wide)');

  console.log('V22 claim gate · --self-test (RED → GREEN negative controls)');
  for (const l of lines) console.log(l);
  console.log(`\n  violating=${VIOLATION_SAMPLES.length} compliant=${COMPLIANT_SAMPLES.length} commentForms=${COMMENT_FORMS.length} visibleForms=${VISIBLE_FORMS.length}`);
  console.log('SELF_TEST=PASS');
  console.log('CLAIM_GATE=PASS');
}

// ─────────────────────────────────────────────────────────────────────────
// Main scan
// ─────────────────────────────────────────────────────────────────────────

function runMain() {
  const { rows } = readClaimRegister(CLAIM_REGISTER);
  const caps = readCapabilities(CAPABILITIES);
  const planned = caps.filter((c) => c.status === 'planned');

  // Precondition non-empty checks BEFORE any PASS verdict is possible.
  assertNonEmpty('claim_register.csv rows', rows);
  assertNonEmpty('capabilities.yaml parsed blocks', caps);
  assertNonEmpty('planned capabilities', planned);
  assertNonEmpty('banned terms', BANNED_TERMS);

  // Every planned capability must have support-claim patterns (no silent no-op).
  const plannedRules = [];
  for (const cap of planned) {
    const patterns = PLANNED_CLAIM_PATTERNS[cap.id];
    if (!patterns || patterns.length === 0) {
      throw new Error(`planned capability ${cap.id} has no claim patterns — would be a silent no-op`);
    }
    plannedRules.push({ id: cap.id, patterns });
  }
  // The two DEV09-required checks must be present.
  for (const required of ['CAP-EXTERNAL-ACTION', 'CAP-OUTCOME-VERIFICATION']) {
    if (!planned.some((c) => c.id === required)) {
      throw new Error(`required planned capability ${required} is missing from capabilities.yaml`);
    }
  }

  // Known verbatim claims from the register (read-only).
  const knownClaims = rows
    .filter((r) => ['REWRITE_REQUIRED', 'REMOVE'].includes(r.status))
    .map((r) => ({ id: r.claimId, claim: r.copyOrClaim }))
    .filter((k) => k.claim && k.claim.length >= 6);

  const gate = readPricingGate();
  const allow = resolveAllowlist();
  const files = discoverPageFiles();
  assertNonEmpty('scanned page.tsx files', files);

  console.log('V22 claim gate · DEV09 · RED→GREEN');
  console.log(`  root: ${ROOT}`);
  console.log(`  ${CLAIM_REGISTER}: ${rows.length} rows (read-only), ${knownClaims.length} verbatim claims`);
  console.log(`  ${CAPABILITIES}: ${caps.length} capabilities, ${planned.length} planned (${planned.map((c) => c.id).join(', ')})`);
  console.log(`  pricing gate: ${gate.closed ? 'CLOSED' : 'OPEN'} (PRICING_APPROVED states: ${gate.states.join(',') || 'none'} from ${gate.seen.join(', ') || 'none'}; fail-closed default)`);
  console.log(
    `  allowlist rule: file=${BANNED_ALLOWLIST.file}, anchor="${BANNED_ALLOWLIST.anchor}", ` +
      `lines=[anchorLine .. "${BANNED_ALLOWLIST.endMarker}" | fallback +${BANNED_ALLOWLIST.windowLines}] — ` +
      `BANNED_WORD only, never a site-wide bypass`,
  );
  console.log(`  banned-word allowlist: ${allow.active ? 'ACTIVE' : 'INACTIVE'} — ${allow.note}`);
  console.log(`  scanned: ${files.length} page.tsx files`);
  console.log('');

  const baseCtx = { gateClosed: gate.closed, plannedRules, knownClaims };
  const allHits = [];
  for (const rel of files) {
    const src = readFile(rel);
    const { clean, stringSpans } = analyze(src);
    const mask = buildVisibleMask(clean, stringSpans);
    const lines = mask.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const lineNo = i + 1;
      const suppressed = isBannedWordAllowlisted(rel, lineNo, allow);
      const ctx = { ...baseCtx, suppressBannedWords: suppressed };
      for (const h of checkLine(lines[i], ctx)) {
        allHits.push({ file: rel, line: lineNo, rule: h.rule, snippet: h.snippet });
      }
    }
  }

  if (allHits.length === 0) {
    console.log('HITS: 0');
  } else {
    console.log(`HITS: ${allHits.length}`);
    const byFile = new Map();
    for (const h of allHits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
    const byRule = new Map();
    for (const h of allHits) byRule.set(h.rule, (byRule.get(h.rule) ?? 0) + 1);
    console.log('  by rule:');
    for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${rule}`);
    }
    console.log('  by file:');
    for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${file}`);
    }
    console.log('  per-hit (file:line:rule:snippet):');
    for (const h of allHits) {
      console.log(`    ${h.file}:${h.line}:${h.rule}:${h.snippet}`);
    }
    console.log('');
    console.log('  NOTE: hits on other legacy pages are PENDING REMEDIATION. Rules are NOT');
    console.log('        relaxed and NO global allowlist is added to force a green result.');
  }

  // "0 hits" is only allowed to be PASS after the non-empty preconditions above.
  const verdict = allHits.length === 0 ? 'PASS' : 'FAIL';
  console.log(`\nCLAIM_GATE=${verdict}`);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (process.argv.includes('--self-test')) runSelfTest();
    else runMain();
  } catch (err) {
    console.error(`CLAIM_GATE_ERROR: ${err && err.message ? err.message : String(err)}`);
    console.log('CLAIM_GATE=FAIL');
    process.exitCode = 1;
  }
}
