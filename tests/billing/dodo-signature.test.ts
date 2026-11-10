/**
 * Dodo webhook 验签 —— 真签名通过 + 六种伪造/降级路径全部拒绝。
 *
 * 为什么这组测试值得单独存在
 * ────────────────────────
 * 验签是**唯一**区分"真的付了钱"和"有人往公开端点 POST 了一个 JSON"的东西。
 * 它一旦被写松（容忍缺头、容忍过期时间戳、容忍不带 `whsec_` 的密钥），
 * 系统不会报错 —— 只会开始给没付钱的人开通权益。
 *
 * 因此这里每一条"应该拒绝"的用例都配一个**只差一件事**的对照组：
 * 同一份 payload、同一个签名，只改一个字段，证明拒绝是由那一个字段触发的，
 * 而不是"反正都失败了"。
 */
import { createHmac } from 'node:crypto';

import {
  computeSignature,
  decodeWebhookSecret,
  parseSignatureHeader,
  verifyDodoSignature,
  SIGNATURE_TOLERANCE_SECONDS,
} from '@/lib/payments/dodo/signature';

/** 合成密钥：base64("lokfeel-test-signing-key-0001")，形状与 Dodo 一致（whsec_ + base64）。 */
const SIGNING_KEY = Buffer.from('lokfeel-test-signing-key-0001');
const SECRET = `whsec_${SIGNING_KEY.toString('base64')}`;

const WEBHOOK_ID = 'evt_test_0001';
const BODY = JSON.stringify({
  type: 'payment.succeeded',
  data: { payment_id: 'pay_1', metadata: { organizationId: 'org_1' } },
});

/** 造一组"当前时间附近"的头，避免测试依赖真实时钟。 */
function headersFor(
  body: string,
  options: { timestamp?: number; secret?: Buffer; id?: string } = {},
): { 'webhook-id': string; 'webhook-timestamp': string; 'webhook-signature': string } {
  const id = options.id ?? WEBHOOK_ID;
  const ts = String(options.timestamp ?? Math.floor(NOW / 1000));
  const sig = createHmac('sha256', options.secret ?? SIGNING_KEY)
    .update(`${id}.${ts}.${body}`)
    .digest('base64');
  return { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` };
}

const NOW = 1_760_000_000_000; // 固定"现在"，让边界用例可复现

describe('Dodo 验签 · 正确的签名必须通过', () => {
  it('原样 body + 正确密钥 ⇒ ok，并回传 webhook-id（幂等键来源）', () => {
    const verdict = verifyDodoSignature(BODY, headersFor(BODY), SECRET, { now: NOW });
    expect(verdict).toEqual({ ok: true, webhookId: WEBHOOK_ID });
  });

  it('computeSignature 与头里的 v1 摘要逐字一致（对拍，防止两处算法漂移）', () => {
    const headers = headersFor(BODY);
    const expected = computeSignature(BODY, WEBHOOK_ID, headers['webhook-timestamp'], SIGNING_KEY);
    expect(headers['webhook-signature']).toBe(`v1,${expected}`);
  });

  it('头里有多条签名（密钥轮换期）时，只要有一条匹配就通过', () => {
    const headers = headersFor(BODY);
    const rotated = createHmac('sha256', Buffer.from('old-key')).update('whatever').digest('base64');
    const withTwo = { ...headers, 'webhook-signature': `v1,${rotated} ${headers['webhook-signature']}` };
    expect(verifyDodoSignature(BODY, withTwo, SECRET, { now: NOW }).ok).toBe(true);
  });

  it('时间戳在容忍窗口内（边界 299s）⇒ 通过', () => {
    const ts = Math.floor(NOW / 1000) - (SIGNATURE_TOLERANCE_SECONDS - 1);
    expect(verifyDodoSignature(BODY, headersFor(BODY, { timestamp: ts }), SECRET, { now: NOW }).ok).toBe(true);
  });
});

describe('Dodo 验签 · 必须拒绝的六种情形', () => {
  it('body 被改一个字节 ⇒ no_matching_signature（对照组：同样输入不改则通过）', () => {
    const headers = headersFor(BODY);
    const tampered = BODY.replace('pay_1', 'pay_2');
    expect(verifyDodoSignature(BODY, headers, SECRET, { now: NOW }).ok).toBe(true);
    const verdict = verifyDodoSignature(tampered, headers, SECRET, { now: NOW });
    expect(verdict).toEqual({ ok: false, reason: 'no_matching_signature' });
  });

  it('用另一个密钥签 ⇒ no_matching_signature', () => {
    const headers = headersFor(BODY, { secret: Buffer.from('attacker-key') });
    expect(verifyDodoSignature(BODY, headers, SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'no_matching_signature',
    });
  });

  it('时间戳超出容忍窗口（301s）⇒ timestamp_out_of_tolerance（防重放）', () => {
    const ts = Math.floor(NOW / 1000) - (SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(verifyDodoSignature(BODY, headersFor(BODY, { timestamp: ts }), SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('时间戳在未来太远（+301s）同样拒绝 —— 只防"过旧"是半个防护', () => {
    const ts = Math.floor(NOW / 1000) + (SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(verifyDodoSignature(BODY, headersFor(BODY, { timestamp: ts }), SECRET, { now: NOW })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    });
  });

  it('缺任意一个头 ⇒ missing_headers（不降级为"放行"）', () => {
    const full = headersFor(BODY);
    for (const key of ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const) {
      const broken = { ...full, [key]: null };
      expect(verifyDodoSignature(BODY, broken, SECRET, { now: NOW })).toEqual({
        ok: false,
        reason: 'missing_headers',
      });
    }
  });

  it('密钥缺 whsec_ 前缀 ⇒ malformed_secret（而不是"宽容地当作合法密钥"）', () => {
    const headers = headersFor(BODY);
    const raw = SIGNING_KEY.toString('base64');
    expect(verifyDodoSignature(BODY, headers, raw, { now: NOW })).toEqual({
      ok: false,
      reason: 'malformed_secret',
    });
  });

  it('签名头里只有 v1a / 无版本前缀 ⇒ no_matching_signature', () => {
    const headers = headersFor(BODY);
    for (const bad of ['v1a,abc', 'plainbase64string']) {
      expect(verifyDodoSignature(BODY, { ...headers, 'webhook-signature': bad }, SECRET, { now: NOW })).toEqual({
        ok: false,
        reason: 'no_matching_signature',
      });
    }
  });
});

describe('Dodo 验签 · 解析辅助函数（可被独立复用）', () => {
  it('decodeWebhookSecret：合法返回非空字节，非法返回 null', () => {
    expect(decodeWebhookSecret(SECRET)?.length).toBe(SIGNING_KEY.length);
    expect(decodeWebhookSecret('whsec_')).toBeNull();
    expect(decodeWebhookSecret('nope')).toBeNull();
  });

  it('parseSignatureHeader：拆出多条 v1 摘要，忽略其它版本与空条目', () => {
    expect(parseSignatureHeader('v1,aaa v1,bbb  v2a,ccc')).toEqual(['aaa', 'bbb']);
    expect(parseSignatureHeader('')).toEqual([]);
  });
});
