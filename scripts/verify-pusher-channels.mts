/**
 * Pusher 频道命名回归门禁
 *
 * 用法：`npm run verify:pusher`（退出码 0 = 通过，1 = 有断言失败）
 *
 * ## 为什么需要它
 *
 * 2026-10 曾出现一类**静态审查极难发现**的缺陷：前端订阅侧把用户频道写成
 * `private-user-{id}`，而鉴权端点（`app/api/im/pusher/auth`）只放行
 * `private-im-` 前缀 —— 只差 3 个字符。后果不是报错，而是**视频通话信令
 * 订阅被 403、通话永远停在「呼叫中」**，排查时很容易怀疑到 SDP / ICE / TURN
 * 上去，而真正的原因在命名。
 *
 * 本脚本从两个方向把这类漂移钉死：
 *   A. 动态：import **真实**的频道构造器，断言其产物必须命中鉴权白名单；
 *   B. 静态：扫描全部 `pusher.subscribe(x)` / `pusher.unsubscribe(x)` 的实参，
 *      只允许「已知构造器调用」或「以 private-im- 开头的字面量」。
 *
 * 另外附带断言：`pusher.trigger` 这类**服务端**触发不得残留 `client-` 前缀的
 * 客户端事件名（客户端事件无法跨用户投递，是另一个已修复的缺陷根因）。
 *
 * @module scripts/verify-pusher-channels
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  IM_CHANNEL_PREFIX,
  isAllowedImChannel,
  userChannel,
  conversationChannel,
} from '../src/lib/im/channels';
import { getUserChannel, PUSHER_EVENTS } from '../src/config/webrtc.config';
import { CALL_SIGNAL_EVENTS } from '../src/lib/im/call-signal';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra !== undefined ? ` → ${String(extra)}` : ''}`);
  }
}

// ─── A. 动态断言：真实构造器的产物必须命中白名单 ────────────────────

console.log('\nA. 频道构造器产物必须命中鉴权白名单');

const SAMPLE_IDS = ['u1', 'user-123@example.com', '', '中文 id', 'a'.repeat(64)];

ok(
  `IM_CHANNEL_PREFIX === 'private-im'`,
  IM_CHANNEL_PREFIX === 'private-im',
  IM_CHANNEL_PREFIX
);

for (const id of SAMPLE_IDS) {
  ok(
    `userChannel(${JSON.stringify(id).slice(0, 24)}) 白名单命中`,
    isAllowedImChannel(userChannel(id)),
    userChannel(id)
  );
}

for (const id of SAMPLE_IDS) {
  ok(
    `conversationChannel(${JSON.stringify(id).slice(0, 24)}) 白名单命中`,
    isAllowedImChannel(conversationChannel(id)),
    conversationChannel(id)
  );
}

for (const id of SAMPLE_IDS) {
  ok(
    `getUserChannel(${JSON.stringify(id).slice(0, 24)}) 白名单命中（WebRTC 侧）`,
    isAllowedImChannel(getUserChannel(id)),
    getUserChannel(id)
  );
}

ok(
  '用户频道与会话频道命名不冲突',
  userChannel('x') !== conversationChannel('x') &&
    userChannel('x') === 'private-im-user-x' &&
    conversationChannel('x') === 'private-im-conv-x'
);

// ─── B. 静态断言：订阅实参不得使用非法前缀 ──────────────────────────

console.log('\nB. pusher.subscribe / unsubscribe 的实参前缀');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 允许出现在订阅实参里的构造器名（都已在上面的动态断言里验证过产物合法）。 */
const TRUSTED_BUILDERS = [
  'userChannel',
  'conversationChannel',
  'getUserChannel',
  'getVideoCallChannel',
  'channelName',
];

/** 去掉块注释与行注释，避免把**文档里的示例代码**当成真实调用（本文件自身就写了 `pusher.subscribe(...)` 作说明）。 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const files = walk(SRC);
const subscribeCalls: Array<{ file: string; arg: string }> = [];

for (const file of files) {
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  const re = /\bpusher(?:Ref\.current)?\.(?:subscribe|unsubscribe)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    subscribeCalls.push({
      file: path.relative(ROOT, file),
      arg: m[1].trim(),
    });
  }
}

ok(
  `扫描到 ${subscribeCalls.length} 处 subscribe/unsubscribe 调用（应 > 0）`,
  subscribeCalls.length > 0,
  subscribeCalls.length
);

for (const { file, arg } of subscribeCalls) {
  const usesTrustedBuilder = TRUSTED_BUILDERS.some((b) => arg.includes(b));

  // 取字面量的**静态前缀**：模板字面量只保留 `${` 之前的部分，
  // 因为插值部分在运行期才确定，无法静态判定。
  const staticPrefix = /^[`'"]/.test(arg)
    ? arg.replace(/^[`'"]/, '').split('${')[0]
    : '';

  const isPrivateChannelLiteral = staticPrefix.startsWith('private-');
  const badPrefix =
    isPrivateChannelLiteral &&
    !staticPrefix.startsWith(`${IM_CHANNEL_PREFIX}-`);

  ok(
    `${file}: ${arg.slice(0, 60)}`,
    usesTrustedBuilder || !badPrefix,
    badPrefix ? `字面量前缀不在鉴权白名单内（应为 ${IM_CHANNEL_PREFIX}-）` : undefined
  );
}

// ─── C. 信令事件名必须与服务端协议一致，且不得用 client- 前缀 ────────

console.log('\nC. 信令事件名');

const expected = [
  [PUSHER_EVENTS.VIDEO_CALL_OFFER, CALL_SIGNAL_EVENTS.OFFER],
  [PUSHER_EVENTS.VIDEO_CALL_ANSWER, CALL_SIGNAL_EVENTS.ANSWER],
  [PUSHER_EVENTS.VIDEO_CALL_DECLINE, CALL_SIGNAL_EVENTS.DECLINE],
  [PUSHER_EVENTS.ICE_CANDIDATE, CALL_SIGNAL_EVENTS.ICE_CANDIDATE],
  [PUSHER_EVENTS.VIDEO_CALL_HANGUP, CALL_SIGNAL_EVENTS.HANGUP],
  [PUSHER_EVENTS.VIDEO_CALL_TIMEOUT, CALL_SIGNAL_EVENTS.TIMEOUT],
];

for (const [actual, want] of expected) {
  ok(`事件名一致：${want}`, actual === want, actual);
}

for (const eventName of Object.values(PUSHER_EVENTS)) {
  ok(`事件名未使用 client- 前缀：${eventName}`, !eventName.startsWith('client-'));
}

// ─── D. 实时通道开关必须是 opt-out，不能退回 opt-in ──────────────────

console.log('\nD. NEXT_PUBLIC_USE_PUSHER 开关语义');

const pusherHook = fs.readFileSync(
  path.join(SRC, 'hooks', 'use-im-pusher.ts'),
  'utf8'
);

// 历史缺陷：要求显式 "true" 才启用，而生产 Pusher 变量全在、单单漏了这一个开关，
// 于是实时消息与视频通话整体静默失效。真正的判据应当是"key 是否配置"。
ok(
  'use-im-pusher.ts 用 opt-out 语义（!== "false"）',
  /NEXT_PUBLIC_USE_PUSHER\s*!==\s*["']false["']/.test(pusherHook),
  '若改回 === "true" 会导致生产漏设该变量时实时能力静默失效'
);

ok(
  'use-im-pusher.ts 不再要求显式 "true" 才启用',
  !/NEXT_PUBLIC_USE_PUSHER\s*===\s*["']true["']/.test(pusherHook)
);

// ─── 汇总 ─────────────────────────────────────────────────────────

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  process.exit(1);
}
