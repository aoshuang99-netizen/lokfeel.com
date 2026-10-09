/**
 * Twitter OAuth redirect_uri 一致性
 *
 * RFC 6749 §4.1.3：授权请求与换取令牌时提交的 redirect_uri 必须逐字符一致。
 * 历史上本仓库两处不一致，导致该链路永远换不到令牌（且失败发生在授权之后）。
 */

import {
  DEFAULT_TWITTER_CALLBACK_PATH,
  twitterCallbackPath,
  twitterCallbackUrl,
} from '@/lib/auth/twitter-oauth';

const ENV_KEY = 'TWITTER_OAUTH_CALLBACK_PATH';

describe('Twitter 回调 URL 单一来源', () => {
  const original = process.env[ENV_KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it('默认路径稳定（防止无意漂移）', () => {
    delete process.env[ENV_KEY];
    expect(DEFAULT_TWITTER_CALLBACK_PATH).toBe('/api/auth/oauth/twitter/callback');
    expect(twitterCallbackPath()).toBe(DEFAULT_TWITTER_CALLBACK_PATH);
  });

  it('拼接不产生双斜杠', () => {
    delete process.env[ENV_KEY];
    expect(twitterCallbackUrl('https://app.lokfeel.com')).toBe(
      `https://app.lokfeel.com${DEFAULT_TWITTER_CALLBACK_PATH}`
    );
    expect(twitterCallbackUrl('https://app.lokfeel.com/')).toBe(
      `https://app.lokfeel.com${DEFAULT_TWITTER_CALLBACK_PATH}`
    );
  });

  it('可用 env 一键对齐开发者后台登记的地址', () => {
    process.env[ENV_KEY] = '/api/auth/twitter/callback';
    expect(twitterCallbackPath()).toBe('/api/auth/twitter/callback');
    expect(twitterCallbackUrl('https://x.com')).toBe(
      'https://x.com/api/auth/twitter/callback'
    );
  });

  it('🔴 非法 env（绝对 URL / 协议相对）被拒绝，不能把用户导向外站', () => {
    process.env[ENV_KEY] = 'https://evil.com/steal';
    expect(twitterCallbackPath()).toBe(DEFAULT_TWITTER_CALLBACK_PATH);

    process.env[ENV_KEY] = '//evil.com/steal';
    expect(twitterCallbackPath()).toBe(DEFAULT_TWITTER_CALLBACK_PATH);

    process.env[ENV_KEY] = '   ';
    expect(twitterCallbackPath()).toBe(DEFAULT_TWITTER_CALLBACK_PATH);
  });

  it('授权与换取令牌取到的是同一个 URL（核心不变量）', () => {
    for (const base of ['https://app.lokfeel.com', 'http://localhost:3099']) {
      const authorize = twitterCallbackUrl(base);
      const exchange = twitterCallbackUrl(base);
      expect(authorize).toBe(exchange);
      expect(authorize.startsWith(`${base.replace(/\/+$/, '')}/api/auth/`)).toBe(true);
    }
  });
});
