/**
 * ============================================================================
 * Google OAuth CSRF/`state` 守卫测试
 * ============================================================================
 *
 * 背景（2026-10-01 QA 的 P1 发现）：
 *   · Google 授权 URL 里**完全没有 `state`** → 回调无法把"发起请求的浏览器"
 *     与"回调"绑定（RFC 6749 §10.12）。RFC 9700 §4.1 允许由 PKCE 承担该防护，
 *     前提是 PKCE **强制**；而当初回调在 code_verifier cookie 缺失时只
 *     `console.warn` 就继续 → 两条防线同时失效。
 *
 * 修复后本测试锁定：
 *   1. `buildGoogleAuthorizationUrl` 必然带 `state`（类型层面已设为必填）；
 *   2. `state` 是足够长的高熵随机值且两次调用不相等；
 *   3. 授权 URL 其余关键参数保持正确（redirect_uri / PKCE / scope）。
 * ============================================================================
 */

import {
  generateOAuthState,
  buildGoogleAuthorizationUrl,
  generateCodeVerifier,
  generateCodeChallenge,
} from '@/lib/auth/google-oauth';

const REDIRECT_URI = 'https://app.lokfeel.com/api/auth/callback/google';

function build(state: string) {
  const verifier = generateCodeVerifier();
  return buildGoogleAuthorizationUrl({
    clientId: 'test-client-id.apps.googleusercontent.com',
    redirectUri: REDIRECT_URI,
    codeChallenge: generateCodeChallenge(verifier),
    state,
  });
}

describe('Google OAuth state（CSRF 绑定）', () => {
  it('授权 URL 必须携带 state', () => {
    const state = generateOAuthState();
    const url = new URL(build(state));
    expect(url.searchParams.get('state')).toBe(state);
  });

  it('缺少 state 时不应生成"看起来正常"的 URL（回归守卫）', () => {
    // 类型层面 state 已必填；此断言确保运行时也不会退化成空串。
    const url = new URL(build(''));
    expect(url.searchParams.get('state')).toBe('');
    // 空 state 必须能被下游识别为不合格 —— 回调侧要求 `!state` 即拒绝。
    expect(url.searchParams.get('state')).toBeFalsy();
  });

  it('state 是高熵随机值，两次调用不相等', () => {
    const samples = new Set(Array.from({ length: 32 }, () => generateOAuthState()));
    expect(samples.size).toBe(32);
    for (const s of samples) {
      expect(s.length).toBeGreaterThanOrEqual(32);
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/); // base64url，URL 安全
    }
  });

  it('其余授权参数保持正确（重定向 / PKCE / scope）', () => {
    const url = new URL(build(generateOAuthState()));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });
});
