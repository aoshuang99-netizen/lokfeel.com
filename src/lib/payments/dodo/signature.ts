/**
 * Dodo Payments —— Webhook 验签（Standard Webhooks 规范的**纯实现**）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 为什么自己写而不是装 `dodopayments` SDK
 * --------------------------------------
 * 1. 本项目依赖安装不可靠（沙箱里 `npm i` 常因 unlink 被拒而中断），
 *    一个只做 HMAC 的验签不值得把构建成功率押上去；
 * 2. 验签是**安全边界**，自己能逐行解释比"信任 SDK"更适合这个仓库的审计风格
 *    （参考 `src/lib/creem.ts` 的手写验签，两者现在同构）；
 * 3. 纯函数 ⇒ 可以不连数据库、不起 Next 服务器就跑单测。
 *
 * ── 规范要点（缺一条就会被伪造或被重放）────────────────────────────────
 *
 *   待签串 = `${webhook-id}.${webhook-timestamp}.${rawBody}`（**原始字节**，不是 JSON.parse 后重新序列化）
 *   密钥   = `whsec_` 前缀去掉后做 base64 解码得到的字节
 *   摘要   = base64(HMAC-SHA256(待签串, 密钥))
 *   头     = `webhook-signature`: 空格分隔的多个 `v1,<digest>`，**任一匹配即通过**
 *   时间   = `webhook-timestamp` 与当前时间相差 > 300s ⇒ 拒绝（防重放）
 *
 * 🔴 最常见的实现错误是 **先 `JSON.parse` 再验签**。
 *    重新序列化会改键序与空白，哈希对不上，于是"每个事件都验签失败"，
 *    而错误信息看起来像"密钥错了"。所以本模块的入参是 `rawBody: string`，
 *    类型上就不给"传对象"的机会。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** 允许的时钟偏移（秒）。Standard Webhooks 参考实现取 5 分钟。 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface DodoSignatureHeaders {
  'webhook-id'?: string | null;
  'webhook-timestamp'?: string | null;
  'webhook-signature'?: string | null;
}

export type SignatureFailureReason =
  | 'missing_headers'
  | 'malformed_secret'
  | 'timestamp_out_of_tolerance'
  | 'no_matching_signature';

export type SignatureResult =
  | { ok: true; webhookId: string }
  | { ok: false; reason: SignatureFailureReason };

/** `header.get()` 返回 `string | null`；这里统一大小写不敏感地取三个头。 */
export function signatureHeadersFrom(get: (name: string) => string | null): DodoSignatureHeaders {
  return {
    'webhook-id': get('webhook-id'),
    'webhook-timestamp': get('webhook-timestamp'),
    'webhook-signature': get('webhook-signature'),
  };
}

/**
 * 从 `whsec_...` 还原签名密钥字节。
 *
 * `whsec_` 后面的部分是 base64。Dodo 控制台给的就是这个形状；
 * 若有人漏了前缀直接贴 base64，这里返回 `null` 并让验签失败 ——
 * 而不是"宽容地"当作合法密钥：那会让一份**错误配置**看起来正常工作，
 * 直到某天换了密钥才发现从来没验过。
 */
export function decodeWebhookSecret(secret: string): Buffer | null {
  if (typeof secret !== 'string') return null;
  const trimmed = secret.trim();
  if (!trimmed.startsWith('whsec_')) return null;
  const b64 = trimmed.slice('whsec_'.length);
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    // base64 解码失败时 Buffer 会给空或截断结果 —— 用长度兜底
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/** 计算期望签名（base64）。导出仅为便于单测对拍与运维排查。 */
export function computeSignature(rawBody: string, webhookId: string, timestamp: string, key: Buffer): string {
  return createHmac('sha256', key).update(`${webhookId}.${timestamp}.${rawBody}`).digest('base64');
}

/**
 * 头里的签名可能有多条（轮换密钥期间 Dodo 会同时带新旧两条）。
 * 拆成 `["<v1 digest>", ...]`，忽略版本不是 `v1` 的条目。
 */
export function parseSignatureHeader(header: string): string[] {
  return header
    .split(' ')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(',');
      if (idx < 0) return null;
      const version = entry.slice(0, idx).trim();
      const digest = entry.slice(idx + 1).trim();
      if (version !== 'v1' || !digest) return null;
      return digest;
    })
    .filter((v): v is string => v !== null);
}

function safeEqualBase64(a: string, b: string): boolean {
  let bufA: Buffer;
  let bufB: Buffer;
  try {
    bufA = Buffer.from(a, 'base64');
    bufB = Buffer.from(b, 'base64');
  } catch {
    return false;
  }
  // 长度不等时 timingSafeEqual 会抛 —— 先比长度（长度不是秘密）
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifyOptions {
  /** 注入"现在"（毫秒），便于单测构造边界用例。 */
  now?: number;
  toleranceSeconds?: number;
}

/**
 * 验签主函数。
 *
 * 返回结构化结果而不是 boolean：调用方要把 `reason` 记进日志（并**只记 reason**，
 * 绝不回显头里的签名片段），否则线上排查「为什么这个事件一直 401」只能靠猜。
 */
export function verifyDodoSignature(
  rawBody: string,
  headers: DodoSignatureHeaders,
  secret: string,
  options: VerifyOptions = {},
): SignatureResult {
  const webhookId = headers['webhook-id']?.trim();
  const timestamp = headers['webhook-timestamp']?.trim();
  const signatureHeader = headers['webhook-signature']?.trim();

  if (!webhookId || !timestamp || !signatureHeader) {
    return { ok: false, reason: 'missing_headers' };
  }

  const key = decodeWebhookSecret(secret);
  if (!key) return { ok: false, reason: 'malformed_secret' };

  const nowMs = options.now ?? Date.now();
  const tolerance = options.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp_out_of_tolerance' };
  const skewSeconds = Math.abs(nowMs / 1000 - ts);
  if (skewSeconds > tolerance) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const expected = computeSignature(rawBody, webhookId, timestamp, key);
  const candidates = parseSignatureHeader(signatureHeader);
  if (candidates.length === 0) return { ok: false, reason: 'no_matching_signature' };

  for (const candidate of candidates) {
    if (safeEqualBase64(expected, candidate)) return { ok: true, webhookId };
  }
  return { ok: false, reason: 'no_matching_signature' };
}
