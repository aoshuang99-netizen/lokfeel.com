/**
 * 构建身份（OPS-11）的断言
 * ═══════════════════════════════════════════════════════════════════════
 * 这个模块的失败模式不是"崩"，而是"**给一个看起来对的错值**"：
 *   · `COMMIT_REF=refs/heads/main` 被当成提交号 ⇒ 运维以为线上是 main 最新；
 *   · 构建时间用运行时 `new Date()` ⇒ 每次探活都"刚刚构建"，永远显得很新；
 *   · 读不到就编一个 ⇒ 回滚时按错版本回。
 *
 * 所以这里的重点全在**反例**：认不出就必须 `unknown`，不许猜。
 */

import { normalizeBuiltAt, normalizeCommit, readBuildInfo } from '@/lib/build-info';

const FULL_SHA = '1cf533f4f863da724e6b62b97def9d592dc93cf0';

describe('normalizeCommit · 只认真正的 sha', () => {
  it('40 位 sha ⇒ 取前 7 位小写', () => {
    expect(normalizeCommit(FULL_SHA)).toBe('1cf533f');
  });

  it('7 位短 sha 原样保留', () => {
    expect(normalizeCommit('1CF533F')).toBe('1cf533f');
  });

  it('ref 路径不算提交号（最容易骗人的一种）', () => {
    expect(normalizeCommit('refs/heads/main')).toBeNull();
  });

  it('HEAD 不算提交号', () => {
    expect(normalizeCommit('HEAD')).toBeNull();
  });

  it('空串 / undefined / null ⇒ null', () => {
    expect(normalizeCommit('')).toBeNull();
    expect(normalizeCommit(undefined)).toBeNull();
    expect(normalizeCommit(null)).toBeNull();
  });

  it('太短（6 位）⇒ null，不能凑一个出来', () => {
    expect(normalizeCommit('1cf533')).toBeNull();
  });

  it('含非十六进制字符 ⇒ null', () => {
    expect(normalizeCommit('zzzzzzz')).toBeNull();
  });
});

describe('normalizeBuiltAt · 只认能解析的时间', () => {
  it('合法 ISO ⇒ 规范化输出', () => {
    expect(normalizeBuiltAt('2026-10-22T12:00:00Z')).toBe('2026-10-22T12:00:00.000Z');
  });

  it('Invalid Date ⇒ null（不把 NaN 写成字符串）', () => {
    expect(normalizeBuiltAt('not-a-date')).toBeNull();
  });

  it('空值 ⇒ null', () => {
    expect(normalizeBuiltAt('')).toBeNull();
    expect(normalizeBuiltAt(undefined)).toBeNull();
  });
});

describe('readBuildInfo · 全空环境', () => {
  it('什么都没有 ⇒ 三个 unknown + source=none，而不是编造', () => {
    expect(readBuildInfo({})).toEqual({
      version: 'unknown',
      commit: 'unknown',
      builtAt: 'unknown',
      commitSource: 'none',
    });
  });

  it('平台注入的 COMMIT_REF 优先于 GITHUB_SHA', () => {
    const info = readBuildInfo({
      COMMIT_REF: FULL_SHA,
      GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(info.commit).toBe('1cf533f');
    expect(info.commitSource).toBe('env');
  });

  it('只有 GITHUB_SHA 时也能读出来', () => {
    const info = readBuildInfo({ GITHUB_SHA: FULL_SHA });
    expect(info.commit).toBe('1cf533f');
  });

  it('NEXT_PUBLIC_BUILD_COMMIT（构建期内联值）优先于原始 env', () => {
    const info = readBuildInfo({
      NEXT_PUBLIC_BUILD_COMMIT: 'abcdef1',
      COMMIT_REF: FULL_SHA,
    });
    expect(info.commit).toBe('abcdef1');
  });

  it('来源可以是 git（自托管 / 本地 docker build）', () => {
    const info = readBuildInfo({
      NEXT_PUBLIC_BUILD_COMMIT: 'abcdef1',
      NEXT_PUBLIC_BUILD_COMMIT_SOURCE: 'git',
    });
    expect(info.commitSource).toBe('git');
  });

  it('来源字段被写坏 ⇒ 回落 env（不因此丢掉 commit）', () => {
    const info = readBuildInfo({
      NEXT_PUBLIC_BUILD_COMMIT: 'abcdef1',
      NEXT_PUBLIC_BUILD_COMMIT_SOURCE: 'whatever',
    });
    expect(info.commitSource).toBe('env');
  });

  it('version 优先取构建期内联值，其次 npm_package_version', () => {
    expect(readBuildInfo({ NEXT_PUBLIC_BUILD_VERSION: '0.9.0' }).version).toBe('0.9.0');
    expect(readBuildInfo({ npm_package_version: '0.8.0' }).version).toBe('0.8.0');
    // 两者都在时以构建期为准
    expect(
      readBuildInfo({ NEXT_PUBLIC_BUILD_VERSION: '0.9.0', npm_package_version: '0.8.0' }).version,
    ).toBe('0.9.0');
  });

  it('builtAt 来自构建期，运行时不会被改写', () => {
    const info = readBuildInfo({ NEXT_PUBLIC_BUILD_TIME: '2026-10-22T12:00:00Z' });
    expect(info.builtAt).toBe('2026-10-22T12:00:00.000Z');
  });
});
