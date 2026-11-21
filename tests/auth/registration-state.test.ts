/**
 * GA-20 注册敏感信息持久化 — TDD 红/绿测试
 *
 * 行为契约（作战包 GA-20 + 07 critical_fail_conditions）：
 *   1. 写入 localStorage 的注册状态必须经严格白名单，绝不含 password / dob /
 *      gender / sexuality / 验证码 token。
 *   2. 恢复时只接受白名单字段；旧版本遗留的敏感缓存必须被清洗读不到。
 *   3. 过期（>24h）状态丢弃。
 *   4. 损坏 JSON 安全返回 null。
 *
 * 测试针对公开接口（纯函数），不 mock 内部实现，可在重构后存活。
 */
import {
  buildPersistableRegState,
  parsePersistedRegState,
  REG_STATE_KEY,
  REG_STATE_TTL_MS,
  REG_STATE_VERSION,
  containsSensitiveKey,
  type RegFormLike,
  type RegSentInfoLike,
} from '@/lib/auth/registration-state';

const FULL_FORM: RegFormLike = {
  name: 'Test User',
  email: 'user@example.test',
  password: 'SuperSecret-P@ssw0rd',
  dob: '1995-03-14',
  gender: 'FEMALE',
  sexuality: 'OTHER',
  agreeToTerms: true,
  confirmAge: true,
};
const SENT_INFO: RegSentInfoLike = {
  maskedIdentifier: 'u***@example.test',
  devMode: true,
  code: '482913', // dev 模式的明文验证码 — 绝不可持久化
};

describe('GA-20 buildPersistableRegState — 写入白名单', () => {
  it('只写入非敏感字段：email/name/agreeToTerms/confirmAge，且阶段与时间戳可恢复', () => {
    const out = buildPersistableRegState('form', FULL_FORM, SENT_INFO, 1_700_000_000_000);
    expect(out).toEqual({
      phase: 'form',
      email: 'user@example.test',
      name: 'Test User',
      agreeToTerms: true,
      confirmAge: true,
      sentInfo: { maskedIdentifier: 'u***@example.test', devMode: true },
      savedAt: 1_700_000_000_000,
    });
  });

  it('序列化后的 JSON 不含任何敏感值或敏感键', () => {
    const json = JSON.stringify(buildPersistableRegState('form', FULL_FORM, SENT_INFO, 1));
    for (const secret of [
      'SuperSecret-P@ssw0rd',
      '1995-03-14',
      'FEMALE',
      '482913',
    ]) {
      expect(json).not.toContain(secret);
    }
    for (const key of ['password', 'dob', 'gender', 'sexuality', 'code']) {
      expect(json).not.toContain(`"${key}"`);
    }
  });

  it('verify 阶段同样剔除验证码，仅保留脱敏标识供展示', () => {
    const out = buildPersistableRegState('verify', FULL_FORM, SENT_INFO, 2);
    const json = JSON.stringify(out);
    expect(out.phase).toBe('verify');
    expect(json).not.toContain('482913');
    expect(json).not.toContain('"code"');
    expect(json).toContain('u***@example.test');
  });

  it('sentInfo 为空时产出稳定的空值结构，不产生 undefined 键', () => {
    const out = buildPersistableRegState('form', FULL_FORM, undefined, 3);
    expect(out.sentInfo).toEqual({ maskedIdentifier: '', devMode: false });
    expect(JSON.stringify(out)).not.toContain('undefined');
  });

  it('白名单字段一律弱类型收敛为非敏感原始值', () => {
    const weird = {
      name: 123 as unknown as string,
      email: { nested: 'evil' } as unknown as string,
      password: 'keep-out',
      agreeToTerms: 'yes' as unknown as boolean,
    };
    const out = buildPersistableRegState('form', weird, undefined, 4);
    expect(typeof out.name).toBe('string');
    expect(typeof out.email).toBe('string');
    expect(out.agreeToTerms).toBe(false);
    expect(JSON.stringify(out)).not.toContain('keep-out');
    expect(JSON.stringify(out)).not.toContain('evil');
  });
});

describe('GA-20 parsePersistedRegState — 读取白名单与旧缓存清洗', () => {
  const now = 1_700_000_100_000;

  it('正常读取白名单状态', () => {
    const state = buildPersistableRegState('verify', FULL_FORM, SENT_INFO, now - 1000);
    const raw = JSON.stringify({ value: state, version: 1 });
    expect(parsePersistedRegState(raw, now)).toEqual(state);
  });

  it('旧版本遗留：即便 payload 内含 password/dob/code，解析结果也不含这些字段', () => {
    // 模拟远端旧代码写下的形态：整个 formData + sentInfo 直接序列化
    const legacyRaw = JSON.stringify({
      phase: 'verify',
      formData: { ...FULL_FORM },
      sentInfo: { ...SENT_INFO },
      savedAt: now - 1000,
    });
    const parsed = parsePersistedRegState(legacyRaw, now);
    const json = JSON.stringify(parsed);
    expect(json).not.toContain('SuperSecret-P@ssw0rd');
    expect(json).not.toContain('1995-03-14');
    expect(json).not.toContain('482913');
    // 但仍能恢复非敏感的 email 供展示/继续
    expect(parsed?.email).toBe('user@example.test');
  });

  it('超过 24 小时的旧状态被丢弃并视为过期', () => {
    const state = buildPersistableRegState('form', FULL_FORM, SENT_INFO, now - REG_STATE_TTL_MS - 1);
    expect(parsePersistedRegState(JSON.stringify(state), now)).toBeNull();
  });

  it('损坏 / 非对象 JSON 安全返回 null，不抛异常', () => {
    expect(parsePersistedRegState('not json', now)).toBeNull();
    expect(parsePersistedRegState('null', now)).toBeNull();
    expect(parsePersistedRegState('[]', now)).toBeNull();
  });

  it('REG_STATE_KEY 稳定，便于旧版本缓存清理定位', () => {
    expect(REG_STATE_KEY).toBe('lokfeel_register_state');
    expect(REG_STATE_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe('GA-20 containsSensitiveKey — 审计辅助', () => {
  it('识别旧格式中的敏感键，白名单 payload 不误报', () => {
    expect(containsSensitiveKey('{"password":"x","email":"a@b.co"}')).toBe(true);
    expect(containsSensitiveKey('{"formData":{"code":"123456"}}')).toBe(true);
    const safe = JSON.stringify(buildPersistableRegState('form', FULL_FORM, SENT_INFO, 1));
    expect(containsSensitiveKey(safe)).toBe(false);
  });
});
